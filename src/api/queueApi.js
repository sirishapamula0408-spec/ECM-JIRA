import { api } from './client.js'

// JL-141: Queues & SLAs-as-a-product
export const fetchQueues = (projectId) =>
  api(`/api/queues${projectId ? `?project=${projectId}` : ''}`)

export const fetchQueue = (id) => api(`/api/queues/${id}`)

export const fetchQueueIssues = (id) => api(`/api/queues/${id}/issues`)

export const createQueue = (data) =>
  api('/api/queues', { method: 'POST', body: JSON.stringify(data) })

export const updateQueue = (id, data) =>
  api(`/api/queues/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deleteQueue = (id) =>
  api(`/api/queues/${id}`, { method: 'DELETE' })
