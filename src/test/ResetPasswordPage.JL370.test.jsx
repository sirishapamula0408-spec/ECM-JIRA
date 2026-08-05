import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import App from '../App'
import { ResetPasswordPage } from '../pages/ResetPasswordPage/ResetPasswordPage'
import { LoginPage } from '../pages/LoginPage/LoginPage'
import { AuthProvider } from '../context/AuthContext'
import { forgotPassword, resetPassword } from '../api/authApi'

// JL-370: the page is the destination of the token link in the password-reset
// email. Only resetPassword/forgotPassword matter here, but the module is
// stubbed wholesale (all 16 exports) so nothing in the App import graph drags
// in the real API client.
vi.mock('../api/authApi', () => ({
  signupWithEmail: vi.fn(),
  loginWithEmail: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  fetchCurrentUser: vi.fn(),
  changePassword: vi.fn(),
  // SSO discovery is fired by LoginPage on mount — resolve as disabled.
  fetchSsoStatus: vi.fn(() => Promise.resolve({ oidc: false, saml: false })),
  startOidcLogin: vi.fn(),
  startSamlLogin: vi.fn(),
  fetchMfaStatus: vi.fn(),
  setupMfa: vi.fn(),
  enableMfa: vi.fn(),
  disableMfa: vi.fn(),
  fetchSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeAllSessions: vi.fn(),
}))

function renderPageAt(token) {
  const search = token == null ? '' : `?token=${encodeURIComponent(token)}`
  return render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <ResetPasswordPage />
    </MemoryRouter>,
  )
}

// Build the error shape src/api/client.js throws: message = payload.error,
// data = the whole payload (carries the JL-134 `errors` array).
function apiError(message, extra) {
  return Object.assign(new Error(message), { status: 400, data: { error: message, ...extra } })
}

async function fillAndSubmit(password) {
  fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: password } })
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: /reset password/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  // No stored session — every scenario here is a signed-out visitor.
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('ResetPasswordPage (JL-370)', () => {
  // The core JL-370 regression: before the fix, an unauthenticated visit to
  // /reset-password fell through the SPA fallback to the login form and the
  // emailed link silently did nothing. The route must resolve signed out.
  it('resolves /reset-password?token=… ahead of the login gate while signed out', async () => {
    render(
      <MemoryRouter initialEntries={['/reset-password?token=email-tok']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: /choose a new password/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument()
    // …and NOT the login form the old code served for this URL.
    expect(screen.queryByRole('button', { name: /^log in$/i })).not.toBeInTheDocument()
  })

  it('submits the token from the query string to the reset endpoint and offers sign-in on success', async () => {
    resetPassword.mockResolvedValueOnce({ message: 'Password has been reset successfully. You can now log in.' })

    renderPageAt('tok-123')
    await fillAndSubmit('NewPassw0rd!')

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('tok-123', 'NewPassw0rd!'))
    expect(await screen.findByText(/reset successfully/i)).toBeInTheDocument()
    // Success routes to the login form (no JWT is issued by the endpoint),
    // consistent with JL-361's accept page.
    expect(screen.getByRole('button', { name: /continue to sign in/i })).toBeInTheDocument()
  })

  it('explains that a link without a token cannot be used', async () => {
    renderPageAt(null)
    expect(await screen.findByText(/missing its token/i)).toBeInTheDocument()
    // No form to submit — the endpoint is never hit with an empty token.
    expect(screen.queryByRole('button', { name: /reset password/i })).not.toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('surfaces the distinct expired-token message from the backend', async () => {
    resetPassword.mockRejectedValueOnce(apiError('Reset token has expired. Please request a new one.'))
    renderPageAt('stale-tok')
    await fillAndSubmit('NewPassw0rd!')
    expect(await screen.findByText(/token has expired/i)).toBeInTheDocument()
  })

  it('surfaces the distinct unknown-token message from the backend', async () => {
    resetPassword.mockRejectedValueOnce(apiError('Invalid or expired reset token'))
    renderPageAt('ghost-tok')
    await fillAndSubmit('NewPassw0rd!')
    expect(await screen.findByText(/invalid or expired reset token/i)).toBeInTheDocument()
  })

  it('lists every JL-134 password-policy violation individually', async () => {
    resetPassword.mockRejectedValueOnce(apiError('Password must contain an uppercase letter', {
      errors: [
        'Password must contain an uppercase letter',
        'Password must contain a number',
      ],
    }))
    renderPageAt('tok-123')
    await fillAndSubmit('weakpassword')

    expect(await screen.findByText(/does not meet the password policy/i)).toBeInTheDocument()
    expect(screen.getByText('Password must contain an uppercase letter')).toBeInTheDocument()
    expect(screen.getByText('Password must contain a number')).toBeInTheDocument()
  })

  // JL-370 keeps the LoginPage manual-paste path intact — old emails told
  // users to paste the token by hand, and with SMTP unconfigured the token is
  // only ever shown in the forgot-password response, not emailed.
  it('does not break the login page manual token-paste flow', async () => {
    forgotPassword.mockResolvedValueOnce({ message: 'sent' }) // no resetToken → user pastes by hand
    resetPassword.mockResolvedValueOnce({ message: 'Password has been reset successfully. You can now log in.' })

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'user@test.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send reset token/i }))

    const tokenInput = await screen.findByLabelText(/reset token/i)
    fireEvent.change(tokenInput, { target: { value: 'pasted-tok' } })
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'NewPassw0rd!' } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'NewPassw0rd!' } })
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('pasted-tok', 'NewPassw0rd!'))
  })
})
