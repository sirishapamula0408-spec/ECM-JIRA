import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useMembers } from '../../context/MemberContext'
import { fetchApiTokens, createApiToken, revokeApiToken } from '../../api/apiTokenApi'
import { fetchMfaStatus, setupMfa, enableMfa, disableMfa, fetchSessions, revokeSession, revokeAllSessions } from '../../api/authApi'
import './ProfilePage.css'

function MfaSection() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [setup, setSetup] = useState(null) // { secret, otpauthUrl }
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // JL-134: set when the org enforces MFA and this user hasn't enrolled (flag
  // written by AuthContext from the login response).
  const [enrollmentRequired, setEnrollmentRequired] = useState(false)

  async function loadStatus() {
    try {
      const res = await fetchMfaStatus()
      setEnabled(Boolean(res.enabled))
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    loadStatus()
    try {
      setEnrollmentRequired(window.sessionStorage.getItem('jira_mfa_enrollment_required') === '1')
    } catch { /* ignore */ }
  }, [])

  // Once MFA is enabled, clear the org nudge.
  useEffect(() => {
    if (enabled) {
      setEnrollmentRequired(false)
      try { window.sessionStorage.removeItem('jira_mfa_enrollment_required') } catch { /* ignore */ }
    }
  }, [enabled])

  async function handleSetup() {
    setBusy(true); setError(''); setMessage('')
    try {
      const res = await setupMfa()
      setSetup(res)
    } catch (err) {
      setError(err?.message || 'Failed to start MFA setup')
    } finally { setBusy(false) }
  }

  async function handleEnable() {
    if (code.length !== 6) return
    setBusy(true); setError(''); setMessage('')
    try {
      await enableMfa(code)
      setEnabled(true)
      setSetup(null)
      setCode('')
      setMessage('Two-factor authentication is now enabled.')
    } catch (err) {
      setError(err?.message || 'Invalid code — try again')
    } finally { setBusy(false) }
  }

  async function handleDisable() {
    setBusy(true); setError(''); setMessage('')
    try {
      await disableMfa()
      setEnabled(false)
      setSetup(null)
      setMessage('Two-factor authentication disabled.')
    } catch (err) {
      setError(err?.message || 'Failed to disable MFA')
    } finally { setBusy(false) }
  }

  return (
    <article className="panel profile-form-panel" style={{ marginTop: 24 }}>
      <h3>Two-Factor Authentication (2FA)</h3>
      <p>Add an extra layer of security by requiring a time-based code from an authenticator app (Google Authenticator, Authy, 1Password) at sign-in.</p>

      {enrollmentRequired && !enabled && (
        <p className="banner" style={{ background: 'var(--warning-bg, #fffae6)', color: 'var(--warning-text, #974f0c)', padding: 8, borderRadius: 4 }}>
          Your organization requires two-factor authentication. Please set it up now to keep your account compliant.
        </p>
      )}

      {!loading && (
        <p style={{ margin: '8px 0' }}>
          Status:{' '}
          <strong style={{ color: enabled ? 'var(--success, #00875a)' : 'var(--text-subtle, #6b778c)' }}>
            {enabled ? 'Enabled' : 'Disabled'}
          </strong>
        </p>
      )}

      {message && <p style={{ color: 'var(--success, #00875a)' }}>{message}</p>}
      {error && <p style={{ color: 'var(--danger, #de350b)' }}>{error}</p>}

      {!enabled && !setup && (
        <button className="btn btn-primary" type="button" onClick={handleSetup} disabled={busy}>
          {busy ? 'Please wait...' : 'Set up 2FA'}
        </button>
      )}

      {!enabled && setup && (
        <div style={{ marginTop: 12 }}>
          <p>1. Add this secret to your authenticator app (or scan the otpauth URL as a QR code):</p>
          <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
            <input readOnly value={setup.secret} style={{ flex: 1, minWidth: 220, fontFamily: 'monospace' }} />
            <button className="btn btn-ghost" type="button" onClick={() => navigator.clipboard?.writeText(setup.secret)}>Copy secret</button>
          </div>
          <input readOnly value={setup.otpauthUrl} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, marginBottom: 12 }} />
          <p>2. Enter the 6-digit code your app shows to confirm:</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              inputMode="numeric"
              style={{ maxWidth: 160, fontFamily: 'monospace', letterSpacing: 2 }}
            />
            <button className="btn btn-primary" type="button" onClick={handleEnable} disabled={busy || code.length !== 6}>
              {busy ? 'Verifying...' : 'Enable'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => { setSetup(null); setCode('') }}>Cancel</button>
          </div>
        </div>
      )}

      {enabled && (
        <button className="btn btn-ghost" type="button" onClick={handleDisable} disabled={busy} style={{ color: 'var(--danger, #de350b)' }}>
          {busy ? 'Please wait...' : 'Disable 2FA'}
        </button>
      )}
    </article>
  )
}

function SessionsSection() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      setSessions(await fetchSessions())
    } catch (err) {
      setError(err?.message || 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function handleRevoke(id) {
    setBusy(true); setError('')
    try { await revokeSession(id); await load() }
    catch (err) { setError(err?.message || 'Failed to revoke session') }
    finally { setBusy(false) }
  }

  async function handleRevokeAll() {
    setBusy(true); setError('')
    try { await revokeAllSessions(); await load() }
    catch (err) { setError(err?.message || 'Failed to sign out other sessions') }
    finally { setBusy(false) }
  }

  return (
    <article className="panel profile-form-panel" style={{ marginTop: 24 }}>
      <h3>Active Sessions & Devices</h3>
      <p>Review where you're signed in. Revoke any session you don't recognize, or sign out everywhere except this device.</p>

      {error && <p style={{ color: 'var(--danger, #de350b)' }}>{error}</p>}

      <table className="sessions-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>Device</th><th>IP address</th><th>Last seen</th><th></th>
          </tr>
        </thead>
        <tbody>
          {!loading && sessions.length === 0 && (
            <tr><td colSpan={4} style={{ padding: 12, color: 'var(--text-subtle, #6b778c)' }}>No active sessions.</td></tr>
          )}
          {sessions.map((s) => (
            <tr key={s.id} style={{ borderTop: '1px solid var(--border, #ebecf0)' }}>
              <td style={{ padding: '8px 4px' }}>
                {s.browser} on {s.os}
                {s.current && <span style={{ marginLeft: 8, color: 'var(--success, #00875a)', fontWeight: 600 }}>(this device)</span>}
              </td>
              <td><code>{s.ip || '—'}</code></td>
              <td>{s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : '—'}</td>
              <td>
                {!s.current && (
                  <button className="btn btn-ghost" type="button" onClick={() => handleRevoke(s.id)} disabled={busy}>Revoke</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {sessions.length > 1 && (
        <button className="btn btn-ghost" type="button" onClick={handleRevokeAll} disabled={busy} style={{ marginTop: 12, color: 'var(--danger, #de350b)' }}>
          {busy ? 'Please wait...' : 'Sign out everywhere else'}
        </button>
      )}
    </article>
  )
}

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

      <MfaSection />

      <SessionsSection />

      <ApiTokensSection />
    </section>
  )
}
