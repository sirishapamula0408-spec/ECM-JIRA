import { createContext, useCallback, useContext, useState } from 'react'
import { loginWithEmail, signupWithEmail } from '../api/authApi'
import { setToken } from '../api/client'
import { parseStoredAuthUser } from '../utils/helpers'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [authUser, setAuthUser] = useState(() => parseStoredAuthUser())
  const [isAuthenticated, setIsAuthenticated] = useState(() => parseStoredAuthUser() !== null)

  const handleAuth = useCallback(async (mode, credentials) => {
    const action = mode === 'signup' ? signupWithEmail : loginWithEmail
    const response = await action(credentials)
    const remember = Boolean(credentials.remember || response.remember)
    setToken(response.token, remember)

    // Store user in the appropriate storage
    const storage = remember ? window.localStorage : window.sessionStorage
    try {
      // Clear from both
      window.localStorage.removeItem('jira_auth_user')
      window.sessionStorage.removeItem('jira_auth_user')
      storage.setItem('jira_auth_user', JSON.stringify(response.user))
    } catch { /* ignore */ }

    setAuthUser(response.user)
    setIsAuthenticated(true)

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

    return response
  }, [])

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
    <AuthContext.Provider value={{ authUser, isAuthenticated, handleAuth, handleLogout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
