import { api } from './client.js'

export const fetchWorklogs = (issueId) =>
  api(`/api/issues/${issueId}/worklogs`)

export const logWork = (issueId, { timeSpent, description }) =>
  api(`/api/issues/${issueId}/worklogs`, { method: 'POST', body: JSON.stringify({ timeSpent, description }) })

export const deleteWorklog = (worklogId) =>
  api(`/api/worklogs/${worklogId}`, { method: 'DELETE' })

export const setEstimate = (issueId, estimate) =>
  api(`/api/issues/${issueId}/estimate`, { method: 'PUT', body: JSON.stringify({ estimate }) })
