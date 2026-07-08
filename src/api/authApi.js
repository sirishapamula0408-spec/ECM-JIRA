import { api } from './client.js'

export function signupWithEmail(payload) {
  return api('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function loginWithEmail(payload) {
  return api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function forgotPassword(email) {
  return api('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function resetPassword(token, newPassword) {
  return api('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  })
}

export function fetchCurrentUser() {
  return api('/api/auth/me')
}

// --- JL-81: MFA (TOTP) ---
export function fetchMfaStatus() {
  return api('/api/auth/mfa/status')
}

export function setupMfa() {
  return api('/api/auth/mfa/setup', { method: 'POST', body: JSON.stringify({}) })
}

export function enableMfa(code) {
  return api('/api/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) })
}

export function disableMfa() {
  return api('/api/auth/mfa/disable', { method: 'POST', body: JSON.stringify({}) })
}
