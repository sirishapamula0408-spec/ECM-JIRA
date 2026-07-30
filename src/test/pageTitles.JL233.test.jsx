import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'
import { NotFoundPage } from '../pages/NotFoundPage/NotFoundPage'
import { LoginPage } from '../pages/LoginPage/LoginPage'
import { usePageTitle, APP_NAME } from '../hooks/usePageTitle'

// Mock the auth API so LoginPage mounts without network calls
vi.mock('../api/authApi', () => ({
  signupWithEmail: vi.fn(),
  loginWithEmail: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  // JL-129: SSO discovery — resolve as disabled so no SSO buttons render.
  fetchSsoStatus: vi.fn(() => Promise.resolve({ oidc: false, saml: false })),
  startOidcLogin: vi.fn(),
  startSamlLogin: vi.fn(),
}))

vi.mock('../api/client', () => ({
  setToken: vi.fn(),
}))

describe('JL-233 — per-page browser tab titles', () => {
  beforeEach(() => {
    document.title = APP_NAME
  })

  it('NotFoundPage sets the tab title to "Page not found"', () => {
    render(
      <BrowserRouter>
        <NotFoundPage />
      </BrowserRouter>,
    )
    expect(document.title).toBe(`Page not found · ${APP_NAME}`)
  })

  it('LoginPage sets the tab title to "Sign in"', () => {
    render(
      <BrowserRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </BrowserRouter>,
    )
    expect(document.title).toBe(`Sign in · ${APP_NAME}`)
  })

  it('supports the IssueDetail dynamic "KEY · summary" format', () => {
    const issue = { id: 7, key: 'JL-233', title: 'Add page titles' }
    renderHook(() =>
      usePageTitle(issue ? `${issue.key || `IT-${issue.id}`} · ${issue.title}` : ''),
    )
    expect(document.title).toBe(`JL-233 · Add page titles · ${APP_NAME}`)
  })

  it('leaves the title unchanged while IssueDetail has no issue loaded yet', () => {
    renderHook(() => usePageTitle(''))
    expect(document.title).toBe(APP_NAME)
  })
})
