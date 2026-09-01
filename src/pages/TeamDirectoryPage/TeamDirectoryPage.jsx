import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Stack, TextField,
} from '@mui/material'
import { fetchTeams, createTeam } from '../../api/teamApi'
import { EmptyState } from '../../components/common/EmptyState'
import { avatarStyle } from '../../utils/avatarColour'
import { MEMBERSHIP_OPTIONS, teamInitials, memberCountLabel } from '../../utils/teamDisplay'
import { usePageTitle } from '../../hooks/usePageTitle'
import './TeamDirectoryPage.css'

const EMPTY_FORM = { name: '', description: '', membership: 'OPEN' }

export function TeamDirectoryPage() {
  usePageTitle('Teams')
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // Debounced copy of `search`; this is what actually reaches the server.
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(() => {
    setLoading(true)
    // Server-side filtering (JL-431): the query goes to the API, we render what
    // comes back. Downloading every team and filtering here is the thing the
    // ticket explicitly says not to copy from the member directory.
    return fetchTeams(query)
      .then((data) => setTeams(Array.isArray(data) ? data : []))
      .catch(() => setTeams([]))
      .finally(() => setLoading(false))
  }, [query])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setForm(EMPTY_FORM)
    setFormError('')
    setShowCreate(true)
  }

  async function submitCreate(event) {
    event.preventDefault()
    setFormError('')
    if (!form.name.trim()) {
      setFormError('Team name is required')
      return
    }
    setSaving(true)
    try {
      const created = await createTeam({
        name: form.name.trim(),
        description: form.description.trim(),
        membership: form.membership,
      })
      setShowCreate(false)
      // Show it immediately rather than waiting for a manual reload. The refetch
      // that follows reconciles member counts and ordering with the server.
      setTeams((current) => [...current, created])
      load()
    } catch (err) {
      // Surface the server's message — swallowing it is how a rejected create
      // looks like a silent no-op.
      setFormError(err?.message || 'Could not create the team')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page team-directory-page">
      <div className="team-directory-header">
        <div>
          <h1>Teams</h1>
          <p className="team-directory-sub">
            Teams in this workspace. Open one to see its members, links and recent work.
          </p>
        </div>
        <Button variant="contained" onClick={openCreate}>Create team</Button>
      </div>

      <TextField
        className="team-directory-search"
        size="small"
        label="Search teams"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        inputProps={{ 'aria-label': 'Search teams by name' }}
      />

      {loading && <p className="team-directory-status">Loading teams…</p>}

      {!loading && teams.length === 0 && (
        <EmptyState
          title={query ? 'No teams match that search' : 'No teams yet'}
          description={
            query
              ? 'Try a different name, or create a team for this group of people.'
              : 'A team gives a group of people a profile, a set of links and a shared view of what they have worked on.'
          }
          action={<Button variant="contained" onClick={openCreate}>Create team</Button>}
        />
      )}

      {!loading && teams.length > 0 && (
        <ul className="team-card-grid">
          {teams.map((team) => (
            <li key={team.id}>
              {/* A real link, not a click handler on a div: it is keyboard
                  reachable and announces as a link (JL-430 AC#5). */}
              <Link className="team-card" to={`/teams/${team.id}`}>
                <span
                  className="team-card-avatar"
                  style={avatarStyle({ id: `team-${team.id}`, name: team.name })}
                  aria-hidden="true"
                >
                  {teamInitials(team.name)}
                </span>
                <span className="team-card-body">
                  <span className="team-card-name">{team.name}</span>
                  {team.description && (
                    <span className="team-card-description">{team.description}</span>
                  )}
                  <span className="team-card-meta">
                    {memberCountLabel(team.memberCount)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* MUI Dialog for the focus trap, Escape-to-close and dialog semantics
          JL-367 had to retrofit onto hand-rolled overlays elsewhere. */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)} fullWidth maxWidth="sm">
        {/* noValidate: the field keeps `required` for the asterisk and
            aria-required, but the browser's own popup would short-circuit
            submitCreate and the page would never get to show its message —
            or the server's. One error surface, ours. */}
        <form onSubmit={submitCreate} noValidate>
          <DialogTitle>Create team</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Team name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                fullWidth
                required
                autoFocus
              />
              <TextField
                label="Description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                fullWidth
                multiline
                minRows={2}
              />
              <TextField
                select
                label="Who can join"
                value={form.membership}
                onChange={(e) => setForm((f) => ({ ...f, membership: e.target.value }))}
                fullWidth
                helperText={
                  MEMBERSHIP_OPTIONS.find((o) => o.value === form.membership)?.hint
                }
              >
                {MEMBERSHIP_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </TextField>
              {formError && <p className="team-form-error" role="alert">{formError}</p>}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={saving}>Create</Button>
          </DialogActions>
        </form>
      </Dialog>
    </div>
  )
}

export default TeamDirectoryPage
