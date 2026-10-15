import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

/* ================================================================
   JL-201 — every user lands on the Projects list right after logging in.

   Only a login started from the home page (or the Dashboard) moves: the
   login form is shown at whatever address was opened, so a login that began
   on an emailed issue link must return to that issue. Logging out returns
   to the home address, so the next login lands on Projects.
   ================================================================ */

vi.mock('../api/authApi', () => ({
  signupWithEmail: vi.fn(),
  loginWithEmail: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  fetchSsoStatus: vi.fn(() => Promise.resolve({ oidc: false, saml: false })),
  startOidcLogin: vi.fn(),
  startSamlLogin: vi.fn(),
}))
vi.mock('../api/client', () => ({ setToken: vi.fn() }))

import { AuthProvider } from '../context/AuthProvider'
import { LoginPage } from '../pages/LoginPage/LoginPage'
import { loginWithEmail, signupWithEmail } from '../api/authApi'
import { postLoginLanding } from '../utils/postLoginLanding'

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

// The app shows the login form at whatever address was opened.
function renderLoginAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="*" element={<><LoginPage /><Where /></>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

async function submitLogin() {
  fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: 'pat@example.com' } })
  fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'Password1!' } })
  fireEvent.click(screen.getByRole('button', { name: /Log In →/ }))
}

describe('postLoginLanding (JL-201)', () => {
  it.each(['/', '', '/dashboard', '/dashboard/'])('sends a login from %j to the Projects list', (path) => {
    expect(postLoginLanding(path)).toBe('/projects')
  })

  it.each(['/issues/OICL-11', '/projects/4/backlog', '/users', '/browse/OICL-11'])('keeps a login that began on %s there', (path) => {
    expect(postLoginLanding(path)).toBeNull()
  })
})

describe('LoginPage — where a successful login lands (JL-201)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    localStorage.clear()
    const session = { user: { id: 1, email: 'pat@example.com' }, token: 'tok' }
    loginWithEmail.mockResolvedValue(session)
    signupWithEmail.mockResolvedValue(session)
  })

  it('lands on the Projects list after logging in from the home page', async () => {
    renderLoginAt('/')
    await submitLogin()
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/projects$/))
  })

  it('lands on the Projects list after logging in from the Dashboard address', async () => {
    renderLoginAt('/dashboard')
    await submitLogin()
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/projects$/))
  })

  it('stays on an emailed issue link after logging in', async () => {
    renderLoginAt('/issues/OICL-11')
    await submitLogin()
    await waitFor(() => expect(loginWithEmail).toHaveBeenCalled())
    // Give any navigation the chance to happen before asserting it did not.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/issues\/OICL-11$/)
  })

  it('does not move when the login fails', async () => {
    loginWithEmail.mockRejectedValue(Object.assign(new Error('Invalid email or password'), { status: 401 }))
    renderLoginAt('/')
    await submitLogin()
    await screen.findByText('Invalid email or password')
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })
})
