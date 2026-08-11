import { createContext, useCallback, useContext, useState } from 'react'
import { loginWithEmail, signupWithEmail } from '../api/authApi'
import { setToken } from '../api/client'
import { parseStoredAuthUser } from '../utils/helpers'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [authUser, setAuthUser] = useState(() => parseStoredAuthUser())
  const [isAuthenticated, setIsAuthenticated] = useState(() => parseStoredAuthUser() !== null)

  // JL-371: adopt a { user, token } pair that was minted by something other than
  // the login/signup forms. The invitation-accept response now returns exactly
  // that shape (see server/routes/invitations.js), and without this the invitee
  // would hold a valid token the SPA never installed — i.e. still be logged out.
  // Extracted from handleAuth rather than duplicated so there is one place that
  // decides where a session is persisted.
  const adoptSession = useCallback(({ user, token }, { remember = false } = {}) => {
    if (!user || !token) return null
    setToken(token, remember)
    const storage = remember ? window.localStorage : window.sessionStorage
    try {
      window.localStorage.removeItem('jira_auth_user')
      window.sessionStorage.removeItem('jira_auth_user')
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
    adoptSession({ user: response.user, token: response.token }, { remember })

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

  const handleLogout = useCallback(() => {
    setToken(null)
    try {
      window.localStorage.removeItem('jira_auth_user')
      window.sessionStorage.removeItem('jira_auth_user')
    } catch { /* ignore */ }
    setAuthUser(null)
    setIsAuthenticated(false)
  }, [])

  return (
    <AuthContext.Provider value={{ authUser, isAuthenticated, handleAuth, handleLogout, adoptSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
