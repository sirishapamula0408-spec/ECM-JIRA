import { api } from './client.js'

// Project-scoped component catalog
export const fetchProjectComponents = (projectId) =>
  api(`/api/projects/${projectId}/components`)

export const createComponent = (projectId, { name, description, lead }) =>
  api(`/api/projects/${projectId}/components`, {
    method: 'POST',
    body: JSON.stringify({ name, description, lead }),
  })

export const updateComponent = (projectId, componentId, { name, description, lead }) =>
  api(`/api/projects/${projectId}/components/${componentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, description, lead }),
  })

export const deleteComponent = (projectId, componentId) =>
  api(`/api/projects/${projectId}/components/${componentId}`, { method: 'DELETE' })

// Issue-scoped component assignment (replace-all)
export const fetchIssueComponents = (issueId) =>
  api(`/api/issues/${issueId}/components`)

export const setIssueComponents = (issueId, componentIds) =>
  api(`/api/issues/${issueId}/components`, {
    method: 'PUT',
    body: JSON.stringify({ componentIds }),
  })
