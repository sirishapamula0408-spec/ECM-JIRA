import { api } from './client.js'

export const fetchMembers = () => api('/api/members')
export const fetchProfile = () => api('/api/profile')

export function updateProfile(payload) {
  return api('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function inviteMember(payload) {
  return api('/api/members', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function resendMemberInvite(id) {
  return api(`/api/members/${id}/resend`, {
    method: 'POST',
  })
}

// JL-197: fetch the user-administration audit trail (Admin only).
// Optional filters: { target, action, limit }.
export function fetchUserAuditLog({ target, action, limit } = {}) {
  const params = new URLSearchParams()
  if (target) params.set('target', target)
  if (action) params.set('action', action)
  if (limit) params.set('limit', String(limit))
  const qs = params.toString()
  return api(`/api/members/audit${qs ? `?${qs}` : ''}`)
}

// JL-194: create a member directly (invite when no password, admin-create with a
// temporary password). Mirrors POST /api/members (JL-192).
export function createMember(payload) {
  return api('/api/members', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// JL-194: change a member's workspace role. PATCH /api/members/:id (JL-191).
export function updateMemberRole(id, role) {
  return api(`/api/members/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

// JL-194: remove a member from the workspace. DELETE /api/members/:id (JL-191).
export function deleteMember(id) {
  return api(`/api/members/${id}`, {
    method: 'DELETE',
  })
}

// JL-194: soft-deactivate a member (blocks login, preserves data). JL-192.
export function deactivateMember(id) {
  return api(`/api/members/${id}/deactivate`, {
    method: 'PATCH',
  })
}

// JL-194: reactivate a previously deactivated member. JL-192.
export function reactivateMember(id) {
  return api(`/api/members/${id}/reactivate`, {
    method: 'PATCH',
  })
}
