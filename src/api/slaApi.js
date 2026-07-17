import { api } from './client.js'

// JL-52: SLA policies + SLA report
export const fetchSlaPolicies = (projectId) =>
  api(`/api/sla-policies${projectId ? `?projectId=${projectId}` : ''}`)

export const createSlaPolicy = (data) =>
  api('/api/sla-policies', { method: 'POST', body: JSON.stringify(data) })

export const updateSlaPolicy = (id, data) =>
  api(`/api/sla-policies/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const deleteSlaPolicy = (id) =>
  api(`/api/sla-policies/${id}`, { method: 'DELETE' })

export const fetchSlaReport = (projectId) =>
  api(`/api/reports/sla?projectId=${projectId}`)
