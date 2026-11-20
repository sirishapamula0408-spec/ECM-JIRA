// JL-480: the SPA no longer holds the session token. The browser sends the
// httpOnly session cookie by itself; the client only echoes the readable CSRF
// cookie, signs out when the server says the session is gone, and wipes any
// token a pre-JL-480 build left in storage.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { api, sessionHeaders, clearLegacyAuthStorage, SESSION_EXPIRED_EVENT } from '../api/client'
import { AuthProvider } from '../context/AuthProvider'
import { useAuth } from '../context/AuthContext'

const clearCookie = (name) => { document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT` }

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  clearCookie('jira_csrf')
  global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }))
})
afterEach(() => vi.restoreAllMocks())

describe('api()', () => {
  it('sends the CSRF cookie back as a header, same-origin credentials, and never an Authorization header', async () => {
    document.cookie = 'jira_csrf=abc123'
    window.localStorage.setItem('jira_auth_token', 'old-token') // must be ignored
    await api('/api/issues/1', { method: 'PATCH', body: '{}' })
    const [, opts] = global.fetch.mock.calls[0]
    expect(opts.credentials).toBe('same-origin')
    expect(opts.headers['X-CSRF-Token']).toBe('abc123')
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect(opts.headers.Authorization).toBeUndefined()
  })

  it('sessionHeaders() is what raw fetch/XHR callers send: CSRF + workspace, no Content-Type', () => {
    document.cookie = 'jira_csrf=xyz'
    window.localStorage.setItem('jira_active_workspace_id', '4')
    expect(sessionHeaders()).toEqual({ 'X-CSRF-Token': 'xyz', 'X-Workspace-Id': '4' })
  })

  it('announces a lost session (expired / revoked / missing) so the app signs out', async () => {
    const seen = vi.fn()
    window.addEventListener(SESSION_EXPIRED_EVENT, seen)
    for (const error of ['Session has been revoked', 'Invalid or expired token', 'Authentication required']) {
      global.fetch.mockResolvedValueOnce(jsonResponse(401, { error }))
      await expect(api('/api/issues')).rejects.toThrow(error)
    }
    expect(seen).toHaveBeenCalledTimes(3)
    window.removeEventListener(SESSION_EXPIRED_EVENT, seen)
  })

  it('does NOT sign out on other 401s (wrong password, MFA challenge)', async () => {
    const seen = vi.fn()
    window.addEventListener(SESSION_EXPIRED_EVENT, seen)
    global.fetch.mockResolvedValueOnce(jsonResponse(401, { error: 'Invalid email or password' }))
    await expect(api('/api/auth/login', { method: 'POST' })).rejects.toThrow()
    global.fetch.mockResolvedValueOnce(jsonResponse(401, { error: 'Current password is incorrect' }))
    await expect(api('/api/auth/change-password', { method: 'POST' })).rejects.toThrow()
    expect(seen).not.toHaveBeenCalled()
    window.removeEventListener(SESSION_EXPIRED_EVENT, seen)
  })
})

describe('clearLegacyAuthStorage', () => {
  it('deletes a token a pre-JL-480 build stored, and reports that it found one', () => {
    window.localStorage.setItem('jira_auth_token', 't1')
    window.localStorage.setItem('jira_auth_remember', '1')
    window.sessionStorage.setItem('jira_auth_token', 't2')
    expect(clearLegacyAuthStorage()).toBe(true)
    expect(window.localStorage.getItem('jira_auth_token')).toBeNull()
    expect(window.localStorage.getItem('jira_auth_remember')).toBeNull()
    expect(window.sessionStorage.getItem('jira_auth_token')).toBeNull()
    expect(clearLegacyAuthStorage()).toBe(false)
  })
})

function Probe() {
  const { isAuthenticated, authUser, handleLogout } = useAuth()
  return (
    <div>
      <span data-testid="state">{isAuthenticated ? `in:${authUser?.email}` : 'out'}</span>
      <button type="button" onClick={handleLogout}>Sign out</button>
    </div>
  )
}

describe('AuthProvider', () => {
  const user = { id: 1, email: 'a@test.com' }

  it('signs a browser out ONCE if it still holds an old stored token (it has no session cookie)', () => {
    window.localStorage.setItem('jira_auth_token', 'old')
    window.localStorage.setItem('jira_auth_user', JSON.stringify(user))
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(screen.getByTestId('state')).toHaveTextContent('out')
    expect(window.localStorage.getItem('jira_auth_token')).toBeNull()
    expect(window.localStorage.getItem('jira_auth_user')).toBeNull()
  })

  it('keeps a post-JL-480 session (user details only, no token) signed in', () => {
    window.sessionStorage.setItem('jira_auth_user', JSON.stringify(user))
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(screen.getByTestId('state')).toHaveTextContent('in:a@test.com')
  })

  it('signs out locally when the server reports the session gone', () => {
    window.sessionStorage.setItem('jira_auth_user', JSON.stringify(user))
    render(<AuthProvider><Probe /></AuthProvider>)
    act(() => { window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT)) })
    expect(screen.getByTestId('state')).toHaveTextContent('out')
    expect(window.sessionStorage.getItem('jira_auth_user')).toBeNull()
  })

  it('Sign out asks the server to revoke the session and clear the cookie', () => {
    window.sessionStorage.setItem('jira_auth_user', JSON.stringify(user))
    document.cookie = 'jira_csrf=c1'
    render(<AuthProvider><Probe /></AuthProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByTestId('state')).toHaveTextContent('out')
    const [url, opts] = global.fetch.mock.calls.find(([u]) => u === '/api/auth/logout')
    expect(url).toBe('/api/auth/logout')
    expect(opts.method).toBe('POST')
  })
})
