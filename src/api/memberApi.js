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

// --- JL-74: Member invitations ---

export const fetchInvitations = (status) =>
  api(`/api/invitations${status ? `?status=${encodeURIComponent(status)}` : ''}`)

export function createInvitation(payload) {
  return api('/api/invitations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export const lookupInvitation = (token) => api(`/api/invitations/${encodeURIComponent(token)}`)

export function acceptInvitation(token, payload = {}) {
  return api(`/api/invitations/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function revokeInvitation(id) {
  return api(`/api/invitations/${id}`, {
    method: 'DELETE',
  })
}
