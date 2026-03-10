const TOKEN_KEY = 'jira_auth_token'
const REMEMBER_KEY = 'jira_auth_remember'

function getStorage() {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) === '1'
      ? window.localStorage
      : window.sessionStorage
  } catch {
    return window.localStorage
  }
}

function getToken() {
  try {
    // Check both storages — token could be in either
    return window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY) || null
  } catch {
    return null
  }
}

export function setToken(token, remember) {
  try {
    // Clear from both storages first
    window.localStorage.removeItem(TOKEN_KEY)
    window.sessionStorage.removeItem(TOKEN_KEY)

    if (token) {
      if (remember !== undefined) {
        // Store the remember preference
        if (remember) {
          window.localStorage.setItem(REMEMBER_KEY, '1')
        } else {
          window.localStorage.removeItem(REMEMBER_KEY)
        }
      }
      const storage = getStorage()
      storage.setItem(TOKEN_KEY, token)
    } else {
      // Logout — clear everything
      window.localStorage.removeItem(REMEMBER_KEY)
    }
  } catch { /* ignore */ }
}

function authHeaders() {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

async function unwrap(response) {
  if (response.ok) {
    return response.json()
  }

  const payload = await response.json().catch(() => null)
  const message = payload?.error || 'Request failed'

  // Emit permission denied event for 403 responses
  if (response.status === 403) {
    window.dispatchEvent(
      new CustomEvent('permission-denied', { detail: { message } }),
    )
  }

  throw new Error(message)
}

export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...options.headers },
  })
  return unwrap(response)
}
