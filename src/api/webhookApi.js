import { api } from './client.js'

export const fetchWebhooks = (projectId) =>
  api(`/api/webhooks${projectId ? `?projectId=${projectId}` : ''}`)

export const fetchWebhook = (id) =>
  api(`/api/webhooks/${id}`)

export const createWebhook = (data) =>
  api('/api/webhooks', { method: 'POST', body: JSON.stringify(data) })

export const updateWebhook = (id, data) =>
  api(`/api/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deleteWebhook = (id) =>
  api(`/api/webhooks/${id}`, { method: 'DELETE' })

export const testWebhook = (id) =>
  api(`/api/webhooks/${id}/test`, { method: 'POST' })

export const fetchWebhookLogs = (id) =>
  api(`/api/webhooks/${id}/logs`)

// JL-150: event catalog + delivery console + replay
export const fetchEventCatalog = () =>
  api('/api/events/catalog')

export const fetchDeliveries = (filters = {}) => {
  const params = new URLSearchParams()
  if (filters.webhookId) params.set('webhookId', filters.webhookId)
  if (filters.status) params.set('status', filters.status)
  if (filters.event) params.set('event', filters.event)
  if (filters.limit) params.set('limit', filters.limit)
  if (filters.offset) params.set('offset', filters.offset)
  const qs = params.toString()
  return api(`/api/webhooks/deliveries${qs ? `?${qs}` : ''}`)
}

export const fetchDelivery = (id) =>
  api(`/api/webhooks/deliveries/${id}`)

export const replayDelivery = (id) =>
  api(`/api/webhooks/deliveries/${id}/replay`, { method: 'POST' })
