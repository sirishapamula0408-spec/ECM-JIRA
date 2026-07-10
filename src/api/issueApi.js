import { api } from './client.js'

export const fetchIssues = () => api('/api/issues')

// JL-75 — global/advanced search. Pass { q } for free-text or { jql } for
// JQL-lite. Returns the same issue shape as fetchIssues.
export function searchIssues({ q, jql } = {}) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (jql) params.set('jql', jql)
  const qs = params.toString()
  return api(`/api/issues${qs ? `?${qs}` : ''}`)
}

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

export function deleteIssue(id) {
  return api(`/api/issues/${id}`, { method: 'DELETE' })
}

// JL-121: bulk change wizard. dryRun=true returns { preview:[] }; dryRun=false
// applies and returns { updated, skipped, errors, results }.
export function bulkChangeIssues({ issueIds, operations, dryRun = false }) {
  return api('/api/issues/bulk', {
    method: 'POST',
    body: JSON.stringify({ issueIds, operations, dryRun }),
  })
}

export function getIssueHistory(id) {
  return api(`/api/issues/${id}/history`)
}

export function fetchSubtasks(parentId) {
  return api(`/api/issues/${parentId}/subtasks`)
}

// JL-76: child issues (Story/Task/Bug) assigned to an Epic + rollup summary
export function fetchEpicChildren(epicId) {
  return api(`/api/issues/${epicId}/epic-children`)
}

export function createSubtask(parentId, payload) {
  return api(`/api/issues/${parentId}/subtasks`, { method: 'POST', body: JSON.stringify(payload) })
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

// JL-139: allow-list of emoji usable as comment reactions (must match backend)
export const REACTION_EMOJIS = ['👍', '👎', '❤️', '🎉', '😄', '👀', '🚀', '😕']

// JL-139: toggle an emoji reaction on a comment; returns the updated summary
export function addReaction(commentId, emoji) {
  return api(`/api/comments/${commentId}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  })
}
