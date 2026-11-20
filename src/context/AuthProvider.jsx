// JL-407: the AuthProvider component lives here, apart from AuthContext.jsx
// which now exports only the context object and the useAuth hook. A module that
// exports a component alongside anything else opts out of Vite fast refresh
// (react-refresh/only-export-components). Splitting this way keeps every
// existing `import { useX } from '../context/XContext'` working — only the
// handful of provider imports (App.jsx and the test harnesses) moved.
//
// JL-480: the session itself is an httpOnly cookie set by the server; this
// provider never sees or stores the token. It keeps only the signed-in user's
// public details (`jira_auth_user`) so the UI knows who is signed in, and signs
// out locally when the server reports the session gone.

import { useCallback, useEffect, useState } from 'react'
import { loginWithEmail, signupWithEmail, logout as logoutRequest, fetchCurrentUser } from '../api/authApi'
import { clearLegacyAuthStorage, SESSION_EXPIRED_EVENT } from '../api/client'
import { parseStoredAuthUser } from '../utils/helpers'
import { AuthContext } from './AuthContext'

function forgetStoredUser() {
  try {
    window.localStorage.removeItem('jira_auth_user')
    window.sessionStorage.removeItem('jira_auth_user')
  } catch { /* ignore */ }
}

// Runs once, before the first render reads the stored user: a browser signed in
// by a pre-JL-480 build holds a token in storage but no session cookie, so it is
// signed out once (the token is deleted) and asked to sign in again.
function initialUser() {
  if (clearLegacyAuthStorage()) forgetStoredUser()
  return parseStoredAuthUser()
}

function ssoReturn() {
  try {
    return new URLSearchParams(window.location.search).get('sso') === '1'
  } catch {
    return false
  }
}

export function AuthProvider({ children }) {
  const [authUser, setAuthUser] = useState(initialUser)
  const [isAuthenticated, setIsAuthenticated] = useState(() => authUser !== null)

  // Record who is signed in. The session cookie was already set by the response
  // that produced `user` (login, signup, invitation accept, SSO). `remember`
  // decides where the user details live — the same lifetime as the cookie.
  // JL-371: also used for sessions minted outside the login/signup forms.
  // A `token` field, if a caller still passes one, is ignored on purpose.
  const adoptSession = useCallback(({ user }, { remember = false } = {}) => {
    if (!user) return null
    const storage = remember ? window.localStorage : window.sessionStorage
    try {
      forgetStoredUser()
      storage.setItem('jira_auth_user', JSON.stringify(user))
    } catch { /* ignore */ }
    setAuthUser(user)
    setIsAuthenticated(true)
    return user
  }, [])

  const handleAuth = useCallback(async (mode, credentials) => {
    const action = mode === 'signup' ? signupWithEmail : loginWithEmail
    const response = await action(credentials)
    const remember = Boolean(credentials.remember || response.remember)
    adoptSession({ user: response.user }, { remember })

    // JL-134: org-wide 2FA nudge. When the org enforces MFA and this user has not
    // enrolled, the login response carries mfaEnrollmentRequired. Persist a flag so
    // ProfilePage can steer them to MFA setup. Non-blocking by design.
    try {
      if (response.mfaEnrollmentRequired) {
        window.sessionStorage.setItem('jira_mfa_enrollment_required', '1')
      } else {
        window.sessionStorage.removeItem('jira_mfa_enrollment_required')
      }
    } catch { /* ignore */ }

    // JL-351: org-wide password-rotation nudge. When the org sets a rotation
    // period and this user's password is past it, the login response carries
    // passwordExpired. Persisted the same way as the MFA flag above so
    // ProfilePage's Change Password section can prompt them. Non-blocking by
    // design — login has already succeeded at this point.
    try {
      if (response.passwordExpired) {
        window.sessionStorage.setItem('jira_password_expired', '1')
      } else {
        window.sessionStorage.removeItem('jira_password_expired')
      }
    } catch { /* ignore */ }

    return response
  }, [adoptSession])

  // Forget the user locally. Used both for "Sign out" and when the server says
  // the session has expired or been revoked.
  const clearLocalSession = useCallback(() => {
    forgetStoredUser()
    setAuthUser(null)
    setIsAuthenticated(false)
  }, [])

  const handleLogout = useCallback(() => {
    // The cookie is httpOnly, so only the server can clear it; it also revokes
    // the session so the token is dead everywhere. Best-effort: sign out locally
    // even if the request fails.
    logoutRequest().catch(() => {})
    clearLocalSession()
  }, [clearLocalSession])

  // The server says the session is gone (expired, revoked, signed out elsewhere).
  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, clearLocalSession)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, clearLocalSession)
  }, [clearLocalSession])

  // SSO (JL-129) signs in with a cookie and redirects back with ?sso=1. Learn who
  // that is from /api/auth/me, then drop the marker from the address bar.
  useEffect(() => {
    if (!ssoReturn()) return
    let cancelled = false
    fetchCurrentUser()
      .then((me) => { if (!cancelled && me?.id) adoptSession({ user: { id: me.id, email: me.email } }) })
      .catch(() => {})
      .finally(() => {
        try {
          const url = new URL(window.location.href)
          url.searchParams.delete('sso')
          window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
        } catch { /* ignore */ }
      })
    return () => { cancelled = true }
  }, [adoptSession])

  return (
    <AuthContext.Provider value={{ authUser, isAuthenticated, handleAuth, handleLogout, adoptSession }}>
      {children}
    </AuthContext.Provider>
  )
}
