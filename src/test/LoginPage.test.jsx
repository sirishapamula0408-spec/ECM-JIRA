import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'
import { LoginPage } from '../pages/LoginPage/LoginPage'

// Mock the auth API
vi.mock('../api/authApi', () => ({
  signupWithEmail: vi.fn(),
  loginWithEmail: vi.fn(),
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

describe('LoginPage', () => {
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
    fireEvent.change(screen.getByPlaceholderText('name@company.com'), {
      target: { value: 'test@test.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'password123' },
    })
    expect(getSubmitButton()).not.toBeDisabled()
  })
})
