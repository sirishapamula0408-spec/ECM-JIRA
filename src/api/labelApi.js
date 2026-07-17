import { api } from './client.js'

// Project-scoped label catalog
export const fetchProjectLabels = (projectId, search = '') =>
  api(`/api/projects/${projectId}/labels${search ? `?search=${encodeURIComponent(search)}` : ''}`)

export const createLabel = (projectId, { name, color }) =>
  api(`/api/projects/${projectId}/labels`, { method: 'POST', body: JSON.stringify({ name, color }) })

// JL-199: rename and/or recolor a catalog label definition
export const updateLabel = (projectId, labelId, { name, color }) =>
  api(`/api/projects/${projectId}/labels/${labelId}`, { method: 'PUT', body: JSON.stringify({ name, color }) })

export const deleteLabel = (projectId, labelId) =>
  api(`/api/projects/${projectId}/labels/${labelId}`, { method: 'DELETE' })

// Issue-scoped label assignment
export const fetchIssueLabels = (issueId) =>
  api(`/api/issues/${issueId}/labels`)

export const setIssueLabels = (issueId, labelIds) =>
  api(`/api/issues/${issueId}/labels`, { method: 'PUT', body: JSON.stringify({ labelIds }) })
