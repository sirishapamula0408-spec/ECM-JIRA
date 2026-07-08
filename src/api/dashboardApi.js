import { api } from './client.js'

export const fetchDashboard = () => api('/api/dashboard')
export const fetchReports = (projectId) =>
  api(projectId ? `/api/reports?projectId=${projectId}` : '/api/reports')
// JL-49: Burndown / Burnup chart data for a sprint.
export const fetchBurndown = (sprintId, unit = 'points') =>
  api(`/api/reports/burndown?sprintId=${sprintId}&unit=${unit}`)
export const fetchBurnup = (sprintId, unit = 'points') =>
  api(`/api/reports/burnup?sprintId=${sprintId}&unit=${unit}`)

// JL-51: Cycle Time Analytics (per-issue cycle/lead days + percentile summary).
export const fetchCycleTime = (projectId, filters = {}) => {
  const query = new URLSearchParams()
  if (projectId) query.set('projectId', projectId)
  if (filters.issueType) query.set('issueType', filters.issueType)
  if (filters.priority) query.set('priority', filters.priority)
  if (filters.assignee) query.set('assignee', filters.assignee)
  const qs = query.toString()
  return api(`/api/reports/cycle-time${qs ? `?${qs}` : ''}`)
}

// JL-87: Sprint Report + Created-vs-Resolved report
export const fetchSprintReport = (sprintId) => api(`/api/reports/sprint/${sprintId}`)

export const fetchCreatedResolved = ({ projectId, days = 30 } = {}) => {
  const query = new URLSearchParams()
  if (projectId) query.set('projectId', projectId)
  if (days) query.set('days', days)
  const qs = query.toString()
  return api(`/api/reports/created-resolved${qs ? `?${qs}` : ''}`)
}
// JL-53: Capacity Planning — per-assignee committed points vs capacity.
export const fetchCapacity = (sprintId) =>
  api(`/api/reports/capacity?sprintId=${sprintId}`)

export const setCapacity = ({ sprintId, assignee, capacityPoints }) =>
  api('/api/reports/capacity', {
    method: 'PUT',
    body: JSON.stringify({ sprintId, assignee, capacityPoints }),
  })

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
