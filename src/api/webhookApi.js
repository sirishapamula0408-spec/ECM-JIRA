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
