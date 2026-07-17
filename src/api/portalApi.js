import { api } from './client.js'

// --- Request-type admin (Admin only) ---
export const fetchRequestTypes = (projectId) =>
  api(`/api/request-types${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`)

export const fetchProjectRequestTypes = (projectId) =>
  api(`/api/projects/${projectId}/request-types`)

export const createRequestType = (payload) =>
  api('/api/request-types', { method: 'POST', body: JSON.stringify(payload) })

export const deleteRequestType = (id) =>
  api(`/api/request-types/${id}`, { method: 'DELETE' })

// --- Customer portal surface ---
export const fetchPortalCatalog = () => api('/api/portal/request-types')

export const submitPortalRequest = (payload) =>
  api('/api/portal/requests', { method: 'POST', body: JSON.stringify(payload) })

export const fetchMyRequests = (email) =>
  api(`/api/portal/requests?email=${encodeURIComponent(email)}`)
