import { api } from './client.js'

export const fetchApprovalRules = (projectId) =>
  api(`/api/approvals/rules${projectId ? `?projectId=${projectId}` : ''}`)

export const createApprovalRule = (data) =>
  api('/api/approvals/rules', { method: 'POST', body: JSON.stringify(data) })

export const deleteApprovalRule = (id) =>
  api(`/api/approvals/rules/${id}`, { method: 'DELETE' })

export const fetchIssueApprovals = (issueId) =>
  api(`/api/approvals/issue/${issueId}`)

export const submitApproval = (issueId, data) =>
  api(`/api/approvals/issue/${issueId}`, { method: 'POST', body: JSON.stringify(data) })

export const checkApproval = (issueId, toStatus) =>
  api(`/api/approvals/check/${issueId}?toStatus=${encodeURIComponent(toStatus)}`)
