import { api } from './client.js'

// List the current user's API tokens (never returns secrets)
export const fetchApiTokens = () => api('/api/api-tokens')

// Create a token — response includes the plaintext `token` field ONCE
export const createApiToken = (data) =>
  api('/api/api-tokens', { method: 'POST', body: JSON.stringify(data) })

// Revoke a token
export const revokeApiToken = (id) =>
  api(`/api/api-tokens/${id}`, { method: 'DELETE' })
