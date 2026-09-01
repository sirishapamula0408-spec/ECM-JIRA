import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Select, Stack, TextField,
} from '@mui/material'
import {
  fetchTeam, updateTeam, addTeamMember, removeTeamMember, updateTeamMemberRole,
  addTeamLink, removeTeamLink, uploadTeamAvatar,
} from '../../api/teamApi'
import { fetchMembers } from '../../api/memberApi'
import { useMembers } from '../../context/MemberContext'
import { EmptyState } from '../../components/common/EmptyState'
import { avatarStyle } from '../../utils/avatarColour'
// JL-434: the ONE sanitiser in this codebase. Its allow-list carries the JL-368
// scheme rules and the JL-358 control-character normalisation. A second regex
// here is exactly what JL-359 deleted a module to prevent.
import { isSafeUrl } from '../../utils/sanitizeHtml'
import { MEMBERSHIP_OPTIONS, teamInitials, memberCountLabel } from '../../utils/teamDisplay'
import { usePageTitle } from '../../hooks/usePageTitle'
import './TeamProfilePage.css'

// Atlassian's documented per-team link limit. The SERVER is the limit (JL-429);
// this constant only lets the UI explain it before someone runs into it.
export const MAX_TEAM_LINKS = 10

const TEAM_ROLES = ['Lead', 'Member']

export function TeamProfilePage() {
  const { teamId } = useParams()
  usePageTitle('Team')
  const { currentMember } = useMembers()
  const [team, setTeam] = useState(null)
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'notfound'
  const [error, setError] = useState('')
  const [workspaceMembers, setWorkspaceMembers] = useState([])
  const [addMemberId, setAddMemberId] = useState('')
  const [linkForm, setLinkForm] = useState({ label: '', url: '' })
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', membership: 'OPEN' })
  const [avatarBlobSrc, setAvatarBlobSrc] = useState(null)
  const fileInputRef = useRef(null)

  // No synchronous setState here: the status only moves once the fetch settles.
  // Calling setStatus('loading') in the body would fire inside the effect below
  // and trip react-hooks/set-state-in-effect (an error in this repo).
  const load = useCallback(() => {
    return fetchTeam(teamId)
      .then((data) => {
        setTeam(data)
        setStatus('ready')
      })
      .catch(() => {
        // A missing or unknown id is a not-found state, not a crash (AC#6).
        setTeam(null)
        setStatus('notfound')
      })
  }, [teamId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetchMembers()
      .then((data) => setWorkspaceMembers(Array.isArray(data) ? data : data?.items || []))
      .catch(() => setWorkspaceMembers([]))
  }, [])

  // The photo lives behind an authenticated endpoint (a plain <img src> cannot
  // send a Bearer header), so it is fetched as a blob exactly as attachment
  // downloads are, and turned into an object URL. Whether a fetch is needed at
  // all is DERIVED during render rather than assigned in the effect — an
  // external https:// avatar needs no request and no state.
  const storedAvatar = team?.avatarUrl || null
  const avatarNeedsFetch = Boolean(storedAvatar && storedAvatar.startsWith('/api/'))
  const avatarSrc = avatarNeedsFetch ? avatarBlobSrc : storedAvatar

  useEffect(() => {
    if (!avatarNeedsFetch) return undefined
    let objectUrl = null
    let cancelled = false
    let token = ''
    try {
      token = window.localStorage.getItem('jira_auth_token')
        || window.sessionStorage.getItem('jira_auth_token') || ''
    } catch { token = '' }
    fetch(storedAvatar, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('no photo'))))
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setAvatarBlobSrc(objectUrl)
      })
      .catch(() => { if (!cancelled) setAvatarBlobSrc(null) })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [avatarNeedsFetch, storedAvatar])

  const myMemberId = currentMember?.memberId ?? null
  const members = useMemo(() => team?.members || [], [team])
  const links = useMemo(() => team?.links || [], [team])
  const myMembership = members.find((m) => m.memberId === myMemberId) || null
  // The server sends its own verdict; falling back to the workspace role keeps
  // the page sane if an older payload arrives without it.
  const canManage = team?.canManage ?? (currentMember?.isOwner || currentMember?.workspaceRole === 'Admin')
  const atLinkCap = links.length >= MAX_TEAM_LINKS

  const candidates = useMemo(() => {
    const taken = new Set(members.map((m) => m.memberId))
    return workspaceMembers.filter((m) => !taken.has(m.id))
  }, [workspaceMembers, members])

  async function act(fn) {
    setError('')
    try {
      await fn()
      await load()
    } catch (err) {
      // Server rejections (the link cap, the last-Lead guard, an invalid URL)
      // are shown, never swallowed — a silent failure looks like success.
      setError(err?.message || 'That did not work')
    }
  }

  function openEdit() {
    setEditForm({
      name: team.name,
      description: team.description || '',
      membership: team.membership,
    })
    setShowEdit(true)
  }

  async function submitEdit(event) {
    event.preventDefault()
    await act(async () => {
      await updateTeam(teamId, editForm)
      setShowEdit(false)
    })
  }

  async function submitLink(event) {
    event.preventDefault()
    await act(async () => {
      await addTeamLink(teamId, linkForm)
      setLinkForm({ label: '', url: '' })
    })
  }

  async function onAvatarPicked(event) {
    const file = event.target.files?.[0]
    if (!file) return
    await act(() => uploadTeamAvatar(teamId, file))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (status === 'loading') {
    return (
      <div className="page team-profile-page">
        <h1>Team</h1>
        <p className="team-profile-status">Loading team…</p>
      </div>
    )
  }

  if (status === 'notfound') {
    return (
      <div className="page team-profile-page">
        <h1>Team not found</h1>
        <EmptyState
          title="We could not find that team"
          description="It may have been deleted, or it belongs to a different workspace."
        />
      </div>
    )
  }

  return (
    <div className="page team-profile-page">
      <header className="team-profile-header">
        <span
          className="team-profile-avatar"
          style={avatarStyle({ id: `team-${team.id}`, name: team.name })}
        >
          {avatarSrc
            ? <img src={avatarSrc} alt="" className="team-profile-avatar-img" />
            : teamInitials(team.name)}
        </span>
        <div className="team-profile-identity">
          <h1>{team.name}</h1>
          {team.description && <p className="team-profile-description">{team.description}</p>}
          <p className="team-profile-meta">
            {memberCountLabel(members.length)}
            {' · '}
            {team.membership === 'OPEN' ? 'Anyone can join' : 'Invite only'}
          </p>
        </div>
        <div className="team-profile-actions">
          {/* Join/Leave follows the membership mode: a MEMBER_INVITE team offers
              no Join at all rather than a button the server always refuses. */}
          {myMembership
            ? (
              <Button
                variant="outlined"
                onClick={() => act(() => removeTeamMember(teamId, myMemberId))}
              >
                Leave team
              </Button>
            )
            : team.membership === 'OPEN' && myMemberId != null && (
              <Button
                variant="contained"
                onClick={() => act(() => addTeamMember(teamId, myMemberId, 'Member'))}
              >
                Join team
              </Button>
            )}
          {canManage && <Button variant="outlined" onClick={openEdit}>Edit team</Button>}
          {canManage && (
            <Button variant="outlined" component="label">
              Change photo
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                hidden
                aria-label="Upload team photo"
                onChange={onAvatarPicked}
              />
            </Button>
          )}
        </div>
      </header>

      {error && <p className="team-profile-error" role="alert">{error}</p>}

      <section className="team-section" aria-labelledby="team-members-heading">
        <h2 id="team-members-heading">Members</h2>
        {members.length === 0
          ? <p className="team-profile-status">Nobody is on this team yet.</p>
          : (
            <ul className="team-member-list">
              {members.map((member) => (
                <li key={member.memberId} className="team-member-row">
                  <span className="team-member-avatar" style={avatarStyle(member)} aria-hidden="true">
                    {teamInitials(member.name)}
                  </span>
                  <span className="team-member-identity">
                    <span className="team-member-name">{member.name}</span>
                    <span className="team-member-email">{member.email}</span>
                  </span>
                  {canManage
                    ? (
                      <Select
                        size="small"
                        value={member.role}
                        inputProps={{ 'aria-label': `Team role for ${member.name}` }}
                        onChange={(e) => act(() => updateTeamMemberRole(teamId, member.memberId, e.target.value))}
                      >
                        {TEAM_ROLES.map((role) => (
                          <MenuItem key={role} value={role}>{role}</MenuItem>
                        ))}
                      </Select>
                    )
                    : <span className="team-member-role">{member.role}</span>}
                  {canManage && (
                    <Button
                      size="small"
                      aria-label={`Remove ${member.name} from the team`}
                      onClick={() => act(() => removeTeamMember(teamId, member.memberId))}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

        {canManage && (
          <div className="team-add-member">
            <Select
              size="small"
              displayEmpty
              value={addMemberId}
              inputProps={{ 'aria-label': 'Add a workspace member to this team' }}
              onChange={(e) => setAddMemberId(e.target.value)}
            >
              <MenuItem value="">Select someone…</MenuItem>
              {candidates.map((m) => (
                <MenuItem key={m.id} value={m.id}>{m.name} ({m.email})</MenuItem>
              ))}
            </Select>
            <Button
              variant="outlined"
              disabled={!addMemberId}
              onClick={() => act(async () => {
                await addTeamMember(teamId, Number(addMemberId), 'Member')
                setAddMemberId('')
              })}
            >
              Add member
            </Button>
          </div>
        )}
      </section>

      <section className="team-section" aria-labelledby="team-links-heading">
        <h2 id="team-links-heading">Links</h2>
        {links.length === 0
          ? <p className="team-profile-status">No links yet.</p>
          : (
            <ul className="team-link-list">
              {links.map((link) => (
                <li key={link.id} className="team-link-row">
                  {isSafeUrl(link.url)
                    ? (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="team-link-anchor"
                      >
                        {link.label}
                      </a>
                    )
                    : (
                      // Neutralised: a URL the shared allow-list rejects is shown
                      // as inert text, never as an href. Historic rows predating
                      // the server-side check reach here too.
                      <span className="team-link-blocked">
                        {link.label} — blocked link
                      </span>
                    )}
                  <span className="team-link-url">{link.url}</span>
                  {canManage && (
                    <Button
                      size="small"
                      aria-label={`Remove link ${link.label}`}
                      onClick={() => act(() => removeTeamLink(teamId, link.id))}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

        {canManage && (
          <form className="team-add-link" onSubmit={submitLink}>
            <TextField
              size="small"
              label="Label"
              value={linkForm.label}
              onChange={(e) => setLinkForm((f) => ({ ...f, label: e.target.value }))}
              disabled={atLinkCap}
            />
            <TextField
              size="small"
              label="URL"
              value={linkForm.url}
              onChange={(e) => setLinkForm((f) => ({ ...f, url: e.target.value }))}
              disabled={atLinkCap}
            />
            <Button type="submit" variant="outlined" disabled={atLinkCap}>Add link</Button>
            <p className="team-link-cap-note">
              {atLinkCap
                ? `A team can have at most ${MAX_TEAM_LINKS} links. Remove one to add another.`
                : `${links.length} of ${MAX_TEAM_LINKS} links used.`}
            </p>
          </form>
        )}
      </section>

      {/* Reserved for the "Worked on" feed (JL-423). */}
      <section className="team-section" aria-labelledby="team-worked-on-heading">
        <h2 id="team-worked-on-heading">Worked on</h2>
        <p className="team-profile-status">Recent activity by this team will appear here.</p>
      </section>

      <Dialog open={showEdit} onClose={() => setShowEdit(false)} fullWidth maxWidth="sm">
        <form onSubmit={submitEdit}>
          <DialogTitle>Edit team</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Team name"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                fullWidth
                required
              />
              <TextField
                label="Description"
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                fullWidth
                multiline
                minRows={2}
              />
              <TextField
                select
                label="Who can join"
                value={editForm.membership}
                onChange={(e) => setEditForm((f) => ({ ...f, membership: e.target.value }))}
                fullWidth
              >
                {MEMBERSHIP_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </TextField>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button type="submit" variant="contained">Save</Button>
          </DialogActions>
        </form>
      </Dialog>
    </div>
  )
}

export default TeamProfilePage
