import { useState } from 'react'
import { useMembers } from '../../context/MemberContext'
import './TeamsPage.css'

export function TeamsPage() {
  const { profile, members, handleInviteMember: onInvite, handleResendInvite: onResend } = useMembers()
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'Viewer' })
  const [inviteState, setInviteState] = useState({ saving: false, error: '', message: '' })
  const [resendState, setResendState] = useState({ id: null, message: '' })
  const [query, setQuery] = useState('')

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
