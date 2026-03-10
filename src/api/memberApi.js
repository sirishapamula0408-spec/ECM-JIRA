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

export function updateMemberRole(id, role) {
  return api(`/api/members/${id}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  })
}
