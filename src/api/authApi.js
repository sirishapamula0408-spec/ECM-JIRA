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

// --- JL-198: Change password for the signed-in user ---
export function changePassword(currentPassword, newPassword) {
  return api('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

// --- JL-129: Live SSO (OIDC / SAML) ---
// Reports which SSO methods are configured/live in this deployment.
export function fetchSsoStatus() {
  return api('/api/auth/sso/status')
}

// Fetch the IdP authorization URL to redirect the browser to.
export function startOidcLogin() {
  return api('/api/auth/sso/oidc')
}

export function startSamlLogin() {
  return api('/api/auth/sso/saml')
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

// --- JL-133: Session / device management ---
export function fetchSessions() {
  return api('/api/sessions')
}

export function revokeSession(id) {
  return api(`/api/sessions/${id}`, { method: 'DELETE' })
}

export function revokeAllSessions() {
  return api('/api/sessions/revoke-all', { method: 'POST', body: JSON.stringify({}) })
}
