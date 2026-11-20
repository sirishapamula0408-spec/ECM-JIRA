// JL-480: the session is an httpOnly cookie the browser sends by itself. This
// module never sees the session token, and nothing stores it — it used to live
// in localStorage/sessionStorage, where any injected script could read it and
// replay it from anywhere for up to 30 days.
//
// What the SPA still has to do on every state-changing request is echo the
// readable `jira_csrf` cookie back in the X-CSRF-Token header; the server
// refuses a cookie-authenticated change without it (server/middleware/authGuard.js).
// Raw fetch() callers (downloads, multipart uploads) use sessionHeaders() so
// they send exactly the same headers as api().

export const CSRF_COOKIE = 'jira_csrf'
export const CSRF_HEADER = 'X-CSRF-Token'

// Keys the pre-JL-480 client stored the session token under.
const LEGACY_TOKEN_KEY = 'jira_auth_token'
const LEGACY_REMEMBER_KEY = 'jira_auth_remember'

// JL-73: active workspace id, mirrors WORKSPACE_STORAGE_KEY in workspaceApi.js.
// Kept as a literal here to avoid a circular import (workspaceApi imports client).
const WORKSPACE_KEY = 'jira_active_workspace_id'

/** The CSRF token from the readable jira_csrf cookie, or null. */
export function getCsrfToken() {
  try {
    for (const part of String(document.cookie || '').split(';')) {
      const eq = part.indexOf('=')
      if (eq > 0 && part.slice(0, eq).trim() === CSRF_COOKIE) {
        return decodeURIComponent(part.slice(eq + 1).trim()) || null
      }
    }
  } catch { /* no document (tests) */ }
  return null
}

function getActiveWorkspace() {
  try {
    return window.localStorage.getItem(WORKSPACE_KEY) || null
  } catch {
    return null
  }
}

/**
 * Headers every authenticated request carries: the CSRF token and the active
 * workspace. No Content-Type, so multipart/binary callers can use it as-is.
 */
export function sessionHeaders() {
  const headers = {}
  const csrf = getCsrfToken()
  if (csrf) headers[CSRF_HEADER] = csrf
  // JL-73: forward the selected workspace so the backend can resolve req.workspaceId.
  const workspaceId = getActiveWorkspace()
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId
  return headers
}

/**
 * One-time migration: delete a session token a pre-JL-480 build left in
 * browser storage. Returns true when one was found — that browser was signed in
 * the old way and has no session cookie, so the caller signs it out.
 */
export function clearLegacyAuthStorage() {
  let found = false
  for (const store of [safeStorage('localStorage'), safeStorage('sessionStorage')]) {
    if (!store) continue
    try {
      if (store.getItem(LEGACY_TOKEN_KEY)) found = true
      store.removeItem(LEGACY_TOKEN_KEY)
      store.removeItem(LEGACY_REMEMBER_KEY)
    } catch { /* ignore */ }
  }
  return found
}

function safeStorage(name) {
  try {
    return window[name] || null
  } catch {
    return null
  }
}

// The authGuard messages that mean "you have no valid session". Other 401s
// (a wrong current password, an MFA challenge) must not sign anyone out.
const SESSION_LOST = new Set(['Authentication required', 'Invalid or expired token', 'Session has been revoked'])

/** Fired on window when the server says the session is gone; AuthProvider signs out. */
export const SESSION_EXPIRED_EVENT = 'auth-session-expired'

async function unwrap(response) {
  if (response.ok) {
    return response.json()
  }

  const payload = await response.json().catch(() => null)
  const message = payload?.error || 'Request failed'

  if (response.status === 401 && SESSION_LOST.has(message)) {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { message } }))
  }

  // Emit permission denied event for 403 responses
  if (response.status === 403) {
    window.dispatchEvent(
      new CustomEvent('permission-denied', { detail: { message } }),
    )
  }

  const error = new Error(message)
  error.status = response.status
  // Preserve extra fields (e.g. JL-81 `mfaRequired`) for callers to inspect.
  if (payload && typeof payload === 'object') error.data = payload
  throw error
}

export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...sessionHeaders(), ...options.headers },
  })
  return unwrap(response)
}
