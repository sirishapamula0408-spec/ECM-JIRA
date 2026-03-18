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
