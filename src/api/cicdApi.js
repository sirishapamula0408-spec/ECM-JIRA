import { api } from './client.js'

export const CI_STATUSES = ['pending', 'running', 'success', 'failed', 'canceled']

export const fetchCiBuilds = (issueId) =>
  api(`/api/issues/${issueId}/ci-builds`)

export const reportCiStatus = (payload) =>
  api('/api/ci/status', { method: 'POST', body: JSON.stringify(payload) })
