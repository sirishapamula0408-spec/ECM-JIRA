import { api } from './client.js'

// JL-131: Issue-level security schemes.
export const fetchSecurityLevels = () => api('/api/security-levels')

export const createSecurityLevel = (payload) =>
  api('/api/security-levels', { method: 'POST', body: JSON.stringify(payload) })

export const deleteSecurityLevel = (id) =>
  api(`/api/security-levels/${id}`, { method: 'DELETE' })

export const setIssueSecurityLevel = (issueId, securityLevelId) =>
  api(`/api/issues/${issueId}/security-level`, {
    method: 'PUT',
    body: JSON.stringify({ securityLevelId }),
  })
