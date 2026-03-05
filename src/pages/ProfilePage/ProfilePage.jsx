import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useMembers } from '../../context/MemberContext'
import './ProfilePage.css'

export function ProfilePage() {
  const { authUser } = useAuth()
  const { profile, members, handleSaveProfile: onSave, handleInviteMember: onInvite, handleResendInvite: onResend } = useMembers()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'Viewer' })
  const [inviteState, setInviteState] = useState({ saving: false, error: '', message: '' })
  const [resendState, setResendState] = useState({ id: null, message: '' })

  // Sync form when profile data loads or changes
  useEffect(() => {
    if (profile) {
      setForm(profile)
    }
  }, [profile])

  if (!form) return null

  const isDirty =
    form.full_name !== (profile?.full_name || '') ||
    form.job_title !== (profile?.job_title || '') ||
    form.department !== (profile?.department || '') ||
    form.timezone !== (profile?.timezone || '') ||
    form.avatar_url !== (profile?.avatar_url || '')

  async function handleSave() { setSaving(true); try { await onSave(form) } finally { setSaving(false) } }
  function handleDiscard() { setForm(profile) }

  function handleAvatarChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setForm((current) => ({ ...current, avatar_url: String(reader.result || '') })) }
    reader.readAsDataURL(file)
  }

  async function handleInviteSubmit(event) {
    event.preventDefault()
    setInviteState({ saving: true, error: '', message: '' })
    try {
      await onInvite({ ...inviteForm, invited_by: form.full_name })
      setInviteForm({ name: '', email: '', role: 'Viewer' })
      setInviteState({ saving: false, error: '', message: 'Invitation sent.' })
      setIsInviteOpen(false)
    } catch (inviteError) { setInviteState({ saving: false, error: inviteError.message, message: '' }) }
  }

  async function handleResend(memberId) {
    setResendState({ id: memberId, message: '' })
    try { await onResend(memberId); setResendState({ id: null, message: 'Invite resent successfully.' }) }
    catch { setResendState({ id: null, message: 'Failed to resend invite.' }) }
  }

  const userEmail = form.email || authUser?.email || ''

  return (
    <section className="page profile-page">
      <div className="split-header profile-header">
        <div>
          <h1>Public Profile</h1>
          <p className="subtitle">Update your personal information and how others see you on the platform.</p>
        </div>
        <div className="profile-actions">
          <button className="btn btn-ghost" type="button" onClick={handleDiscard} disabled={!isDirty || saving}>Discard</button>
          <button className="btn btn-primary" type="button" onClick={handleSave} disabled={!isDirty || saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </div>

      <section className="profile-top">
        <article className="panel profile-avatar-panel">
          <h3>Avatar</h3>
          <p>This will be displayed on your profile and next to your tasks.</p>
          <div className="avatar-preview-wrap">
            {form.avatar_url ? (
              <img className="avatar-preview" src={form.avatar_url} alt="Profile avatar" />
            ) : (
              <div className="avatar-preview avatar-fallback">{(form.full_name || 'U').slice(0, 2).toUpperCase()}</div>
            )}
            <label className="avatar-upload-btn">Edit<input type="file" accept="image/*" onChange={handleAvatarChange} /></label>
          </div>
          <small>Recommended: 400x400px. Max 2MB.</small>
        </article>

        <article className="panel profile-form-panel">
          <div className="profile-grid">
            <label>Full Name<input value={form.full_name} onChange={(event) => setForm((c) => ({ ...c, full_name: event.target.value }))} /></label>
            <label>Email Address<input value={userEmail} disabled className="profile-email-input" /></label>
            <label>Job Title<input value={form.job_title} onChange={(event) => setForm((c) => ({ ...c, job_title: event.target.value }))} /></label>
            <label>Department
              <select value={form.department} onChange={(event) => setForm((c) => ({ ...c, department: event.target.value }))}>
                <option value="">Select department</option>
                <option>Design & Creative</option><option>Engineering</option><option>Product</option><option>Operations</option>
              </select>
            </label>
            <label>Timezone
              <select value={form.timezone} onChange={(event) => setForm((c) => ({ ...c, timezone: event.target.value }))}>
                <option value="">Select timezone</option>
                <option>(GMT+05:30) India Standard Time</option>
                <option>(GMT-08:00) Pacific Time</option><option>(GMT-06:00) Central Time</option><option>(GMT-05:00) Eastern Time</option><option>(GMT+00:00) UTC</option>
              </select>
            </label>
          </div>
        </article>
      </section>

      <article className="panel">
        <div className="split-header">
          <div><h3>Team Members</h3><p className="subtitle">Manage your team's access and roles within the workspace.</p></div>
          <button className="btn btn-ghost invite-btn" type="button" onClick={() => setIsInviteOpen((c) => !c)}>+ Invite Colleague</button>
        </div>

        {isInviteOpen && (
          <form className="invite-form" onSubmit={handleInviteSubmit}>
            <input placeholder="Name" value={inviteForm.name} onChange={(event) => setInviteForm((c) => ({ ...c, name: event.target.value }))} required />
            <input placeholder="Email" type="email" value={inviteForm.email} onChange={(event) => setInviteForm((c) => ({ ...c, email: event.target.value }))} required />
            <select value={inviteForm.role} onChange={(event) => setInviteForm((c) => ({ ...c, role: event.target.value }))}>
              <option>Viewer</option><option>Member</option><option>Admin</option>
            </select>
            <button className="btn btn-primary" type="submit" disabled={inviteState.saving}>{inviteState.saving ? 'Sending...' : 'Send Invite'}</button>
          </form>
        )}
        {inviteState.error && <p className="banner error">{inviteState.error}</p>}
        {inviteState.message && <p className="banner">{inviteState.message}</p>}
        {resendState.message && <p className="banner">{resendState.message}</p>}

        <table className="table">
          <thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>
                  <div className="member-cell">
                    <span className="member-avatar">{member.name.slice(0, 2).toUpperCase()}</span>
                    <div>
                      <strong>{member.name}</strong>
                      <small>{member.email}</small>
                      {member.invited_by && <small>Invited by {member.invited_by}</small>}
                    </div>
                  </div>
                </td>
                <td><span className="pill">{member.role}</span></td>
                <td><span className={`pill ${member.status === 'Active' ? 'pill-green' : 'pill-gray'}`}>{member.status}</span></td>
                <td>
                  {member.status === 'Invited' ? (
                    <button className="link-btn" type="button" onClick={() => handleResend(member.id)} disabled={resendState.id === member.id}>{resendState.id === member.id ? 'Resending...' : 'Resend'}</button>
                  ) : (
                    <button className="icon-btn" type="button" aria-label="Member actions">&#8942;</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  )
}
