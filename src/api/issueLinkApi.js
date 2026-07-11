import { api } from './client.js'

export const LINK_TYPES = ['blocks', 'is blocked by', 'relates to', 'duplicates', 'is duplicated by']

export const fetchIssueLinks = (issueId) =>
  api(`/api/issues/${issueId}/links`)

export const createIssueLink = (issueId, { type, targetIssueId }) =>
  api(`/api/issues/${issueId}/links`, { method: 'POST', body: JSON.stringify({ type, targetIssueId }) })

export const deleteIssueLink = (linkId) =>
  api(`/api/links/${linkId}`, { method: 'DELETE' })
