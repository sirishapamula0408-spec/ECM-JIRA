import { useEffect, useState } from 'react'
import { FormControlLabel, Switch, TextField } from '@mui/material'
import { fetchNotificationPreferences, updateNotificationPreferences } from '../../api/notificationApi'

// JL-200: allowed digest values mirror the backend check in
// server/routes/notifications.js (PUT /api/notifications/preferences).
const DIGEST_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
]

/**
 * Notification Preferences section (JL-200), mounted on ProfilePage.
 * Loads the user's preferences on mount (GET /api/notifications/preferences)
 * and saves on every change (PUT), with inline success/error feedback.
 */
export function NotificationPreferencesSection() {
  // Kept in the PUT payload shape: { inApp, emailEnabled, emailDigest, mutedTypes }
  const [prefs, setPrefs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchNotificationPreferences()
      .then((res) => {
        if (cancelled) return
        // GET returns the DB row in snake_case; normalize to the PUT shape.
        setPrefs({
          inApp: res.in_app !== false,
          emailEnabled: Boolean(res.email_enabled),
          emailDigest: res.email_digest || 'off',
          mutedTypes: Array.isArray(res.muted_types) ? res.muted_types : [],
        })
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load notification preferences')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function save(next) {
    setPrefs(next)
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await updateNotificationPreferences(next)
      setMessage('Preferences saved')
    } catch (err) {
      setError(err?.message || 'Failed to save preferences')
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="panel profile-form-panel" style={{ marginTop: 24 }}>
      <h3>Notification Preferences</h3>
      <p>Choose how you want to be notified about mentions, assignments, comments, and watched issues.</p>

      {message && <p role="status" style={{ color: 'var(--success, #00875a)' }}>{message}</p>}
      {error && <p role="alert" style={{ color: 'var(--danger, #de350b)' }}>{error}</p>}
      {loading && <p style={{ color: 'var(--text-subtle, #6b778c)' }}>Loading preferences...</p>}

      {prefs && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420, marginTop: 8 }}>
          <FormControlLabel
            control={
              <Switch
                checked={prefs.inApp}
                onChange={(event) => save({ ...prefs, inApp: event.target.checked })}
                disabled={saving}
              />
            }
            label="In-app notifications"
          />
          <FormControlLabel
            control={
              <Switch
                checked={prefs.emailEnabled}
                onChange={(event) => save({ ...prefs, emailEnabled: event.target.checked })}
                disabled={saving}
              />
            }
            label="Email notifications"
          />
          <TextField
            select
            size="small"
            label="Email digest frequency"
            value={prefs.emailDigest}
            onChange={(event) => save({ ...prefs, emailDigest: event.target.value })}
            disabled={saving}
            slotProps={{ select: { native: true }, htmlInput: { 'aria-label': 'Email digest frequency' } }}
            helperText="Bundle email notifications into a periodic digest instead of sending them one by one."
          >
            {DIGEST_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </TextField>
        </div>
      )}
    </article>
  )
}
