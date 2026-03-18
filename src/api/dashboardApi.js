import { api } from './client.js'

export const fetchDashboard = () => api('/api/dashboard')
export const fetchReports = (projectId) =>
  api(projectId ? `/api/reports?projectId=${projectId}` : '/api/reports')
export const fetchRoadmap = () => api('/api/roadmap')
export const fetchWorkflows = () => api('/api/workflows')
export const fetchActivity = (params = {}) => {
  const query = new URLSearchParams()
  if (params.type) query.set('type', params.type)
  if (params.projectId) query.set('projectId', params.projectId)
  if (params.actor) query.set('actor', params.actor)
  if (params.limit) query.set('limit', params.limit)
  if (params.offset) query.set('offset', params.offset)
  if (params.cursor) query.set('cursor', params.cursor)
  if (params.dateFrom) query.set('dateFrom', params.dateFrom)
  if (params.dateTo) query.set('dateTo', params.dateTo)
  const qs = query.toString()
  return api(`/api/activity${qs ? `?${qs}` : ''}`)
}
