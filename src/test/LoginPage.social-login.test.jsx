import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'
import { LoginPage } from '../pages/LoginPage/LoginPage'

// Mock the auth API
vi.mock('../api/authApi', () => ({
  signupWithEmail: vi.fn(),
  loginWithEmail: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
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

describe('LoginPage social login removal (JL-2)', () => {
  it('does not render a "Continue with Google" control', () => {
    renderLoginPage()
    expect(screen.queryByText(/continue with google/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /google/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /google/i })
    ).not.toBeInTheDocument()
  })

  it('does not render a "Continue with GitHub" control', () => {
    renderLoginPage()
    expect(screen.queryByText(/continue with github/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /github/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /github/i })
    ).not.toBeInTheDocument()
  })

  it('does not render an "or" divider or SSO button row', () => {
    const { container } = renderLoginPage()
    expect(container.querySelector('.login-divider')).toBeNull()
    expect(container.querySelector('.login-sso-row')).toBeNull()
    expect(container.querySelector('.login-sso-btn')).toBeNull()
  })

  it('still renders email and password inputs on the login form', () => {
    renderLoginPage()
    const email = screen.getByPlaceholderText('name@company.com')
    const password = screen.getByPlaceholderText('Enter your password')
    expect(email).toBeInTheDocument()
    expect(email).toHaveAttribute('type', 'email')
    expect(password).toBeInTheDocument()
    expect(password).toHaveAttribute('type', 'password')
    expect(
      screen.getByRole('button', { name: /Log In →/ })
    ).toBeInTheDocument()
  })

  it('does not render social login controls on the signup form either', () => {
    renderLoginPage()
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }))
    expect(screen.getByText('Create your account')).toBeInTheDocument()
    expect(screen.queryByText(/continue with/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /google|github/i })
    ).not.toBeInTheDocument()
    // Email + password still present in signup mode
    expect(screen.getByPlaceholderText('name@company.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Min. 6 characters')).toBeInTheDocument()
  })
})
