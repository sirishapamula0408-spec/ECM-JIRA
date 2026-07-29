import { api } from './client.js'

export const fetchNotifications = (params = {}) => {
  const query = new URLSearchParams()
  if (params.unread) query.set('unread', 'true')
  if (params.limit) query.set('limit', params.limit)
  if (params.offset) query.set('offset', params.offset)
  const qs = query.toString()
  return api(`/api/notifications${qs ? `?${qs}` : ''}`)
}

export const markNotificationRead = (id) =>
  api(`/api/notifications/${id}/read`, { method: 'PATCH' })

export const markAllNotificationsRead = () =>
  api('/api/notifications/read-all', { method: 'PATCH' })

export const deleteNotification = (id) =>
  api(`/api/notifications/${id}`, { method: 'DELETE' })

export const clearReadNotifications = () =>
  api('/api/notifications/read', { method: 'DELETE' })

export const fetchNotificationPreferences = () =>
  api('/api/notifications/preferences')

export const updateNotificationPreferences = (prefs) =>
  api('/api/notifications/preferences', { method: 'PUT', body: JSON.stringify(prefs) })

// JL-304: Admin-only — verify SMTP connectivity and send a test email to the
// requesting admin. Returns { configured, ok, sent, consoleFallback, to, error }.
export const sendTestEmail = () =>
  api('/api/notifications/mail-test', { method: 'POST' })
