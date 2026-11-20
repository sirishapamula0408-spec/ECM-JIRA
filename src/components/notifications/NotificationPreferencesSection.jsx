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

// Per-event email switches. Each one is stored inverted, as an entry in
// `mutedTypes`; the type names are the ones createNotification() is called with
// (server/services/issueNotifications.js, routes/comments.js, services/mentions.js).
// Muting affects email only — the in-app notification is still recorded.
const EMAIL_EVENT_OPTIONS = [
  { type: 'issue_assigned', label: 'An issue is assigned to me' },
  { type: 'issue_created', label: 'An issue I reported is created' },
  { type: 'status_changed', label: 'An issue I am assigned, reported or watch changes status' },
  { type: 'comment', label: 'Someone comments on an issue I watch' },
  { type: 'mention', label: 'Someone @mentions me' },
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
          // Email is on unless switched off (matches the server default).
          emailEnabled: res.email_enabled !== false,
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
          <fieldset
            disabled={saving || !prefs.emailEnabled}
            style={{ border: 'none', margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column' }}
          >
            <legend style={{ padding: 0, color: 'var(--text-subtle, #6b778c)' }}>Email me when…</legend>
            {EMAIL_EVENT_OPTIONS.map((option) => (
              <FormControlLabel
                key={option.type}
                control={
                  <Switch
                    size="small"
                    checked={prefs.emailEnabled && !prefs.mutedTypes.includes(option.type)}
                    onChange={(event) => save({
                      ...prefs,
                      mutedTypes: event.target.checked
                        ? prefs.mutedTypes.filter((t) => t !== option.type)
                        : [...prefs.mutedTypes, option.type],
                    })}
                    disabled={saving || !prefs.emailEnabled}
                  />
                }
                label={option.label}
              />
            ))}
          </fieldset>
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
