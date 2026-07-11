import { api } from './client.js'

export const fetchWatchers = (issueId) =>
  api(`/api/issues/${issueId}/watchers`)

export const watchIssue = (issueId) =>
  api(`/api/issues/${issueId}/watchers`, { method: 'POST' })

export const unwatchIssue = (issueId) =>
  api(`/api/issues/${issueId}/watchers`, { method: 'DELETE' })
