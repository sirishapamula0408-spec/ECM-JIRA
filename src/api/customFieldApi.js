import { api } from './client.js'

export const fetchProjectCustomFields = (projectId) =>
  api(`/api/projects/${projectId}/custom-fields`)

export const createCustomField = (projectId, { name, fieldType, options, config }) =>
  api(`/api/projects/${projectId}/custom-fields`, { method: 'POST', body: JSON.stringify({ name, fieldType, options, config }) })

export const deleteCustomField = (fieldId) =>
  api(`/api/custom-fields/${fieldId}`, { method: 'DELETE' })

export const fetchIssueCustomFields = (issueId) =>
  api(`/api/issues/${issueId}/custom-fields`)

export const setIssueCustomField = (issueId, fieldId, value) =>
  api(`/api/issues/${issueId}/custom-fields/${fieldId}`, { method: 'PUT', body: JSON.stringify({ value }) })
