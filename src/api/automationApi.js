import { api } from './client.js'

export const fetchAutomationRules = (projectId) =>
  api(`/api/projects/${projectId}/automation-rules`)

export const createAutomationRule = (projectId, body) =>
  api(`/api/projects/${projectId}/automation-rules`, { method: 'POST', body: JSON.stringify(body) })

export const updateAutomationRule = (ruleId, body) =>
  api(`/api/automation-rules/${ruleId}`, { method: 'PATCH', body: JSON.stringify(body) })

export const deleteAutomationRule = (ruleId) =>
  api(`/api/automation-rules/${ruleId}`, { method: 'DELETE' })

export const fetchAutomationLogs = (projectId) =>
  api(`/api/projects/${projectId}/automation-logs`)
