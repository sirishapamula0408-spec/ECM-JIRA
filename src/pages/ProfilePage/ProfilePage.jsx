import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useMembers } from '../../context/MemberContext'
import './ProfilePage.css'

export function ProfilePage() {
  const { authUser } = useAuth()
  const { profile, handleSaveProfile: onSave } = useMembers()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

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
    </section>
  )
}
