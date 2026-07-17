import { useState, useEffect, useCallback } from 'react'
import { useMembers } from '../../context/MemberContext'
import { usePermissions } from '../../hooks/usePermissions'
import { fetchInvitations, createInvitation, revokeInvitation } from '../../api/memberApi'
import { fetchSecurityPolicy, updateSecurityPolicy } from '../../api/securityPolicyApi'
import './TeamsPage.css'
import { usePageTitle } from '../../hooks/usePageTitle'

export function TeamsPage() {
  usePageTitle('Teams')
  const { profile, members, handleInviteMember: onInvite, handleResendInvite: onResend } = useMembers()
  const { canInviteMembers, isAdmin } = usePermissions()

  // JL-134: org-wide security policy (enforced 2FA + password rules)
  const [policy, setPolicy] = useState(null)
  const [policyState, setPolicyState] = useState({ saving: false, error: '', message: '' })

  const loadPolicy = useCallback(async () => {
    try {
      const p = await fetchSecurityPolicy()
      setPolicy(p)
    } catch {
      /* ignore — non-fatal */
    }
  }, [])

  useEffect(() => {
    loadPolicy()
  }, [loadPolicy])

  async function handleSavePolicy(event) {
    event.preventDefault()
    if (!policy) return
    setPolicyState({ saving: true, error: '', message: '' })
    try {
      const saved = await updateSecurityPolicy(policy)
      setPolicy(saved)
      setPolicyState({ saving: false, error: '', message: 'Security policy updated.' })
    } catch (err) {
      setPolicyState({ saving: false, error: err.message, message: '' })
    }
  }

  function setPolicyField(field, value) {
    setPolicy((c) => ({ ...c, [field]: value }))
  }
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'Viewer' })
  const [inviteState, setInviteState] = useState({ saving: false, error: '', message: '' })
  const [resendState, setResendState] = useState({ id: null, message: '' })
  const [query, setQuery] = useState('')

  // JL-74: token-based invitations
  const [invites, setInvites] = useState([])
  const [inviteEmailForm, setInviteEmailForm] = useState({ email: '', role: 'Member' })
  const [sendState, setSendState] = useState({ saving: false, error: '', message: '' })

  const loadInvites = useCallback(async () => {
    if (!canInviteMembers) return
    try {
      const rows = await fetchInvitations('pending')
      setInvites(rows)
    } catch {
      /* ignore — non-admins can't list */
    }
  }, [canInviteMembers])

  useEffect(() => {
    loadInvites()
  }, [loadInvites])

  async function handleSendInvitation(event) {
    event.preventDefault()
    setSendState({ saving: true, error: '', message: '' })
    try {
      await createInvitation(inviteEmailForm)
      setInviteEmailForm({ email: '', role: 'Member' })
      setSendState({ saving: false, error: '', message: 'Invitation sent.' })
      loadInvites()
    } catch (err) {
      setSendState({ saving: false, error: err.message, message: '' })
    }
  }

  async function handleRevoke(id) {
    try {
      await revokeInvitation(id)
      loadInvites()
    } catch {
      /* ignore */
    }
  }

  async function handleInviteSubmit(event) {
    event.preventDefault()
    setInviteState({ saving: true, error: '', message: '' })
    try {
      await onInvite({ ...inviteForm, invited_by: profile?.full_name || '' })
      setInviteForm({ name: '', email: '', role: 'Viewer' })
      setInviteState({ saving: false, error: '', message: 'Invitation sent successfully.' })
      setIsInviteOpen(false)
    } catch (inviteError) {
      setInviteState({ saving: false, error: inviteError.message, message: '' })
    }
  }

  async function handleResend(memberId) {
    setResendState({ id: memberId, message: '' })
    try {
      await onResend(memberId)
      setResendState({ id: null, message: 'Invite resent successfully.' })
    } catch {
      setResendState({ id: null, message: 'Failed to resend invite.' })
    }
  }

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = members.filter((m) => {
    if (!normalizedQuery) return true
    return m.name.toLowerCase().includes(normalizedQuery) || m.email.toLowerCase().includes(normalizedQuery)
  })

  return (
    <section className="page teams-page">
      <div className="teams-header">
        <div>
          <h1>Teams</h1>
          <p className="teams-subtitle">Manage your team members and their roles within the workspace.</p>
        </div>
        <div className="teams-header-actions">
          <label className="teams-search">
            <span className="teams-search-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search members"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" type="button" onClick={() => setIsInviteOpen((c) => !c)}>
            + Invite Member
          </button>
        </div>
      </div>

      {isInviteOpen && (
        <article className="panel teams-invite-panel">
          <h3>Invite a new member</h3>
          <form className="teams-invite-form" onSubmit={handleInviteSubmit}>
            <label>
              Name
              <input placeholder="Full name" value={inviteForm.name} onChange={(e) => setInviteForm((c) => ({ ...c, name: e.target.value }))} required />
            </label>
            <label>
              Email
              <input placeholder="Email address" type="email" value={inviteForm.email} onChange={(e) => setInviteForm((c) => ({ ...c, email: e.target.value }))} required />
            </label>
            <label>
              Role
              <select value={inviteForm.role} onChange={(e) => setInviteForm((c) => ({ ...c, role: e.target.value }))}>
                <option>Viewer</option>
                <option>Member</option>
                <option>Admin</option>
              </select>
            </label>
            <div className="teams-invite-actions">
              <button className="btn btn-primary" type="submit" disabled={inviteState.saving}>
                {inviteState.saving ? 'Sending...' : 'Send Invite'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setIsInviteOpen(false)}>Cancel</button>
            </div>
          </form>
          {inviteState.error && <p className="banner error">{inviteState.error}</p>}
        </article>
      )}

      {inviteState.message && <p className="banner">{inviteState.message}</p>}
      {resendState.message && <p className="banner">{resendState.message}</p>}

      {canInviteMembers && (
        <article className="panel teams-invitations-panel">
          <h3>Invite Members</h3>
          <p className="teams-subtitle">
            Send a token-based invitation email. The recipient joins with the assigned role when they accept.
          </p>
          <form className="teams-invite-form" onSubmit={handleSendInvitation}>
            <label>
              Email
              <input
                placeholder="Email address"
                type="email"
                value={inviteEmailForm.email}
                onChange={(e) => setInviteEmailForm((c) => ({ ...c, email: e.target.value }))}
                required
              />
            </label>
            <label>
              Role
              <select value={inviteEmailForm.role} onChange={(e) => setInviteEmailForm((c) => ({ ...c, role: e.target.value }))}>
                <option>Viewer</option>
                <option>Member</option>
                <option>Admin</option>
              </select>
            </label>
            <div className="teams-invite-actions">
              <button className="btn btn-primary" type="submit" disabled={sendState.saving}>
                {sendState.saving ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </form>
          {sendState.error && <p className="banner error">{sendState.error}</p>}
          {sendState.message && <p className="banner">{sendState.message}</p>}

          {invites.length > 0 && (
            <table className="table teams-table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Invited By</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.email}</td>
                    <td><span className="pill">{inv.role}</span></td>
                    <td><small>{inv.invited_by}</small></td>
                    <td><small>{new Date(inv.expires_at).toLocaleDateString()}</small></td>
                    <td>
                      <button className="link-btn" type="button" onClick={() => handleRevoke(inv.id)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      )}

      {isAdmin && policy && (
        <article className="panel teams-security-panel">
          <h3>Security Policy</h3>
          <p className="teams-subtitle">
            Enforce two-factor authentication and password complexity across the whole organization.
            Rules apply at registration and password change.
          </p>
          <form className="teams-security-form" onSubmit={handleSavePolicy}>
            <label className="teams-security-check">
              <input
                type="checkbox"
                checked={Boolean(policy.require_mfa)}
                onChange={(e) => setPolicyField('require_mfa', e.target.checked)}
              />
              Require all users to enable two-factor authentication (MFA)
            </label>

            <label>
              Minimum password length
              <input
                type="number"
                min="1"
                max="128"
                value={policy.min_password_length ?? 8}
                onChange={(e) => setPolicyField('min_password_length', Number(e.target.value))}
              />
            </label>

            <label className="teams-security-check">
              <input
                type="checkbox"
                checked={Boolean(policy.require_uppercase)}
                onChange={(e) => setPolicyField('require_uppercase', e.target.checked)}
              />
              Require at least one uppercase letter
            </label>
            <label className="teams-security-check">
              <input
                type="checkbox"
                checked={Boolean(policy.require_number)}
                onChange={(e) => setPolicyField('require_number', e.target.checked)}
              />
              Require at least one number
            </label>
            <label className="teams-security-check">
              <input
                type="checkbox"
                checked={Boolean(policy.require_symbol)}
                onChange={(e) => setPolicyField('require_symbol', e.target.checked)}
              />
              Require at least one symbol
            </label>

            <label>
              Password rotation (days, 0 = never expire)
              <input
                type="number"
                min="0"
                max="3650"
                value={policy.password_max_age_days ?? 0}
                onChange={(e) => setPolicyField('password_max_age_days', Number(e.target.value))}
              />
            </label>

            <div className="teams-invite-actions">
              <button className="btn btn-primary" type="submit" disabled={policyState.saving}>
                {policyState.saving ? 'Saving...' : 'Save Policy'}
              </button>
            </div>
          </form>
          {policyState.error && <p className="banner error">{policyState.error}</p>}
          {policyState.message && <p className="banner">{policyState.message}</p>}
        </article>
      )}

      <article className="panel teams-table-shell">
        {filtered.length === 0 ? (
          <div className="teams-empty">
            {normalizedQuery ? 'No members match your search.' : 'No team members yet. Invite someone to get started.'}
          </div>
        ) : (
          <table className="table teams-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Tasks</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div className="teams-member-cell">
                      <span className="teams-member-avatar">{member.name.slice(0, 2).toUpperCase()}</span>
                      <div>
                        <strong>{member.name}</strong>
                        <small>{member.email}</small>
                        {member.invited_by && <small className="teams-invited-by">Invited by {member.invited_by}</small>}
                      </div>
                    </div>
                  </td>
                  <td><span className="pill">{member.role}</span></td>
                  <td>
                    <span className={`pill ${member.status === 'Active' ? 'pill-green' : 'pill-gray'}`}>
                      {member.status}
                    </span>
                  </td>
                  <td>{member.task_count || 0}</td>
                  <td>
                    {member.status === 'Invited' ? (
                      <button className="link-btn" type="button" onClick={() => handleResend(member.id)} disabled={resendState.id === member.id}>
                        {resendState.id === member.id ? 'Resending...' : 'Resend Invite'}
                      </button>
                    ) : (
                      <span className="teams-active-label">Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  )
}
