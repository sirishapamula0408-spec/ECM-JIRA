import { api } from './client.js'

// JL-214: Issue voting (mirrors watcherApi.js)

export const fetchVotes = (issueId) =>
  api(`/api/issues/${issueId}/votes`)

export const voteIssue = (issueId) =>
  api(`/api/issues/${issueId}/votes`, { method: 'POST' })

export const unvoteIssue = (issueId) =>
  api(`/api/issues/${issueId}/votes`, { method: 'DELETE' })
