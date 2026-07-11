import { api } from './client.js'

// JL-134: Org-wide security policy (enforced 2FA + password rules).

export function fetchSecurityPolicy() {
  return api('/api/security-policy')
}

export function updateSecurityPolicy(policy) {
  return api('/api/security-policy', {
    method: 'PUT',
    body: JSON.stringify(policy),
  })
}
