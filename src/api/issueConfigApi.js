import { api } from './client.js'

// ── Priorities ──
export const fetchProjectPriorities = (projectId) =>
  api(`/api/projects/${projectId}/priorities`)

export const createPriority = (projectId, { name, color, position }) =>
  api(`/api/projects/${projectId}/priorities`, { method: 'POST', body: JSON.stringify({ name, color, position }) })

export const updatePriority = (priorityId, patch) =>
  api(`/api/priorities/${priorityId}`, { method: 'PUT', body: JSON.stringify(patch) })

export const deletePriority = (priorityId) =>
  api(`/api/priorities/${priorityId}`, { method: 'DELETE' })

// ── Statuses ──
export const fetchProjectStatuses = (projectId) =>
  api(`/api/projects/${projectId}/statuses`)

export const createStatus = (projectId, { name, color, category, position }) =>
  api(`/api/projects/${projectId}/statuses`, { method: 'POST', body: JSON.stringify({ name, color, category, position }) })

export const updateStatus = (statusId, patch) =>
  api(`/api/statuses/${statusId}`, { method: 'PUT', body: JSON.stringify(patch) })

export const deleteStatus = (statusId) =>
  api(`/api/statuses/${statusId}`, { method: 'DELETE' })
