import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useMembers } from '../../context/MemberContext'
import { fetchApiTokens, createApiToken, revokeApiToken } from '../../api/apiTokenApi'
import './ProfilePage.css'

function ApiTokensSection() {
  const [tokens, setTokens] = useState([])
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState('read')
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState(null) // plaintext shown once
  const [error, setError] = useState('')

  async function load() {
    try { setTokens(await fetchApiTokens()) } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [])

  async function handleCreate() {
    if (!name.trim()) return
    setCreating(true); setError('')
    try {
      const res = await createApiToken({ name: name.trim(), scopes })
      setNewToken(res.token)
      setName('')
      await load()
    } catch (err) {
      setError(err?.message || 'Failed to create token')
    } finally { setCreating(false) }
  }

  async function handleRevoke(id) {
    try { await revokeApiToken(id); await load() } catch { /* ignore */ }
  }

  return (
    <article className="panel profile-form-panel" style={{ marginTop: 24 }}>
      <h3>API Tokens</h3>
      <p>Generate personal tokens to access the public REST API (<code>/api/public</code>). Tokens are shown only once.</p>

      {newToken && (
        <div className="api-token-reveal" style={{ background: 'var(--surface-hover, #f4f5f7)', padding: 12, borderRadius: 6, margin: '12px 0' }}>
          <strong>Copy your new token now — it won't be shown again:</strong>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input readOnly value={newToken} style={{ flex: 1, fontFamily: 'monospace' }} />
            <button className="btn btn-ghost" type="button" onClick={() => navigator.clipboard?.writeText(newToken)}>Copy</button>
            <button className="btn btn-ghost" type="button" onClick={() => setNewToken(null)}>Dismiss</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', margin: '12px 0' }}>
        <label style={{ flex: 1, minWidth: 180 }}>Token name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CI pipeline" />
        </label>
        <label>Scopes
          <select value={scopes} onChange={(e) => setScopes(e.target.value)}>
            <option value="read">read</option>
            <option value="read,write">read, write</option>
            <option value="*">all (*)</option>
          </select>
        </label>
        <button className="btn btn-primary" type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? 'Creating...' : 'Create token'}
        </button>
      </div>
      {error && <p style={{ color: 'var(--danger, #de350b)' }}>{error}</p>}

      <table className="api-tokens-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {tokens.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 12, color: 'var(--text-subtle, #6b778c)' }}>No API tokens yet.</td></tr>
          )}
          {tokens.map((t) => (
            <tr key={t.id} style={{ borderTop: '1px solid var(--border, #ebecf0)' }}>
              <td style={{ padding: '8px 4px' }}>{t.name}</td>
              <td><code>{t.token_prefix}…</code></td>
              <td>{t.scopes}</td>
              <td>{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'Never'}</td>
              <td>{t.revoked ? 'Revoked' : 'Active'}</td>
              <td>
                {!t.revoked && (
                  <button className="btn btn-ghost" type="button" onClick={() => handleRevoke(t.id)}>Revoke</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  )
}

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

      <ApiTokensSection />
    </section>
  )
}
