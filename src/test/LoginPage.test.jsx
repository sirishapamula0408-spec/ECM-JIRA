import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'
import { LoginPage } from '../pages/LoginPage/LoginPage'
import { loginWithEmail, signupWithEmail } from '../api/authApi'

// Mock the auth API
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

function renderLoginPage() {
  return render(
    <BrowserRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </BrowserRouter>
  )
}

function getSubmitButton() {
  return screen.getByRole('button', { name: /Log In →/ })
}

function fillCredentials() {
  fireEvent.change(screen.getByPlaceholderText('name@company.com'), {
    target: { value: 'test@test.com' },
  })
  fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
    target: { value: 'password123' },
  })
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the login form', () => {
    renderLoginPage()
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('name@company.com')).toBeInTheDocument()
    expect(getSubmitButton()).toBeInTheDocument()
  })

  it('disables submit button when fields are empty', () => {
    renderLoginPage()
    expect(getSubmitButton()).toBeDisabled()
  })

  it('enables submit button when both fields filled', () => {
    renderLoginPage()
    fillCredentials()
    expect(getSubmitButton()).not.toBeDisabled()
  })
})

// JL-264 — accessibility
describe('LoginPage accessibility (JL-264)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the auth error inside a role="alert" live region', async () => {
    loginWithEmail.mockRejectedValueOnce(new Error('Authentication failed'))
    renderLoginPage()
    fillCredentials()
    fireEvent.click(getSubmitButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Authentication failed')
    expect(alert).toHaveAttribute('aria-live', 'assertive')
  })

  it('exposes the mode switcher buttons with aria-pressed state', () => {
    renderLoginPage()
    const logInTab = screen.getByRole('button', { name: 'Log In' })
    const signUpTab = screen.getByRole('button', { name: 'Sign Up' })
    expect(logInTab).toHaveAttribute('aria-pressed', 'true')
    expect(signUpTab).toHaveAttribute('aria-pressed', 'false')
  })

  it('password toggle exposes aria-pressed', () => {
    renderLoginPage()
    const toggle = screen.getByRole('button', { name: /show password/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(
      screen.getByRole('button', { name: /hide password/i })
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('email input uses autoComplete="username email"', () => {
    renderLoginPage()
    expect(screen.getByPlaceholderText('name@company.com')).toHaveAttribute(
      'autocomplete',
      'username email'
    )
  })
})

// JL-265 — UX quick wins
describe('LoginPage UX quick wins (JL-265)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('autofocuses the email field on initial render', () => {
    renderLoginPage()
    expect(screen.getByPlaceholderText('name@company.com')).toHaveFocus()
  })

  it('sets a descriptive document title', () => {
    renderLoginPage()
    expect(document.title).toBe('Sign in — ECM JIRA')
  })

  it('shows a Caps Lock hint when getModifierState reports it on', () => {
    renderLoginPage()
    const password = screen.getByPlaceholderText('Enter your password')
    expect(screen.queryByText('Caps Lock is on')).not.toBeInTheDocument()

    const makeKeyEvent = (type, capsOn) => {
      const ev = new KeyboardEvent(type, { key: 'a', bubbles: true })
      Object.defineProperty(ev, 'getModifierState', { value: () => capsOn })
      return ev
    }

    fireEvent(password, makeKeyEvent('keydown', true))
    expect(screen.getByText('Caps Lock is on')).toBeInTheDocument()
    fireEvent(password, makeKeyEvent('keyup', false))
    expect(screen.queryByText('Caps Lock is on')).not.toBeInTheDocument()
  })

  it('shows an inline error on blur of an invalid email', () => {
    renderLoginPage()
    const email = screen.getByPlaceholderText('name@company.com')
    fireEvent.change(email, { target: { value: 'not-an-email' } })
    fireEvent.blur(email)
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(email).toHaveAttribute('aria-invalid', 'true')
  })
})

// JL-266 — lockout (429) feedback
describe('LoginPage lockout feedback (JL-266)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a live countdown and disables submit on a 429 with retryAfter', async () => {
    loginWithEmail.mockRejectedValueOnce(
      Object.assign(new Error('Too many failed login attempts.'), {
        status: 429,
        data: { retryAfter: 90 },
      })
    )
    renderLoginPage()
    fillCredentials()
    fireEvent.click(getSubmitButton())

    const alert = await screen.findByText(/Too many failed attempts\. Try again in 1:30\./)
    expect(alert).toBeInTheDocument()
    await waitFor(() => expect(getSubmitButton()).toBeDisabled())
  })

  it('falls back to the server message (submit enabled) when retryAfter is missing', async () => {
    loginWithEmail.mockRejectedValueOnce(
      Object.assign(new Error('Too many failed login attempts.'), {
        status: 429,
        data: {},
      })
    )
    renderLoginPage()
    fillCredentials()
    fireEvent.click(getSubmitButton())

    await screen.findByText('Too many failed login attempts.')
    expect(getSubmitButton()).not.toBeDisabled()
  })
})

// JL-267 — full password-policy errors
describe('LoginPage full password errors (JL-267)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders every violation from a signup 400 with an errors array', async () => {
    signupWithEmail.mockRejectedValueOnce(
      Object.assign(new Error('Password must contain an uppercase letter'), {
        status: 400,
        data: {
          error: 'Password must contain an uppercase letter',
          errors: [
            'Password must contain an uppercase letter',
            'Password must contain a number',
          ],
        },
      })
    )
    renderLoginPage()
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }))
    fireEvent.change(screen.getByPlaceholderText('name@company.com'), {
      target: { value: 'new@test.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Min. 6 characters'), {
      target: { value: 'weak' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Create Account/ }))

    expect(
      await screen.findByText('Password must contain an uppercase letter')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Password must contain a number')
    ).toBeInTheDocument()
  })
})
