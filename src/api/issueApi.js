import { api } from './client.js'

export const fetchIssues = () => api('/api/issues')

export function fetchIssueById(id) {
  return api(`/api/issues/${id}`)
}

export function createIssue(payload) {
  return api('/api/issues', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateIssue(id, fields) {
  return api(`/api/issues/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

export function updateIssueStatus(id, status, sprintId) {
  return api(`/api/issues/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, sprintId }),
  })
}

export function fetchComments(issueId) {
  return api(`/api/issues/${issueId}/comments`)
}

export function createComment(issueId, payload) {
  return api(`/api/issues/${issueId}/comments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
