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
