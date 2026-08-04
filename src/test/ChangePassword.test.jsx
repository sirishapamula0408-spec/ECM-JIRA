import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChangePasswordSection } from '../pages/ProfilePage/ProfilePage'
import { changePassword } from '../api/authApi'

// Mock the auth API — ChangePasswordSection only depends on changePassword, but
// the module is stubbed wholesale so its other exports don't pull in real deps.
vi.mock('../api/authApi', () => ({
  changePassword: vi.fn(),
  fetchMfaStatus: vi.fn(() => Promise.resolve({ enabled: false })),
  setupMfa: vi.fn(),
  enableMfa: vi.fn(),
  disableMfa: vi.fn(),
  fetchSessions: vi.fn(() => Promise.resolve([])),
  revokeSession: vi.fn(),
  revokeAllSessions: vi.fn(),
}))

function fillAndSubmit({ current, next, confirm }) {
  fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: current } })
  fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: next } })
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: /change password/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
})

describe('ChangePasswordSection (JL-198)', () => {
  it('calls changePassword with the entered values and shows success', async () => {
    changePassword.mockResolvedValueOnce({ message: 'Password changed successfully.' })
    render(<ChangePasswordSection />)

    fillAndSubmit({ current: 'oldpass1', next: 'brandnew2', confirm: 'brandnew2' })

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith('oldpass1', 'brandnew2')
    })
    expect(await screen.findByText(/changed successfully/i)).toBeInTheDocument()
  })

  it('shows the server error message when the request fails', async () => {
    changePassword.mockRejectedValueOnce(new Error('Current password is incorrect'))
    render(<ChangePasswordSection />)

    fillAndSubmit({ current: 'wrongpass', next: 'brandnew2', confirm: 'brandnew2' })

    expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument()
  })

  it('does not call the API when the confirmation does not match', () => {
    render(<ChangePasswordSection />)

    fillAndSubmit({ current: 'oldpass1', next: 'brandnew2', confirm: 'different2' })

    expect(changePassword).not.toHaveBeenCalled()
    expect(screen.getByText(/do not match/i)).toBeInTheDocument()
  })
})

// JL-351: the org password-rotation nudge. AuthContext writes
// `jira_password_expired` from the login response; this section is where it is
// surfaced, since it is the control that actually resolves it.
describe('ChangePasswordSection rotation nudge (JL-351)', () => {
  it('shows the rotation warning when the login flagged the password as expired', () => {
    window.sessionStorage.setItem('jira_password_expired', '1')
    render(<ChangePasswordSection />)

    expect(screen.getByText(/older than the rotation period/i)).toBeInTheDocument()
  })

  it('shows nothing when the flag is absent', () => {
    render(<ChangePasswordSection />)

    expect(screen.queryByText(/older than the rotation period/i)).not.toBeInTheDocument()
  })

  it('clears the warning and the flag once the password is changed', async () => {
    window.sessionStorage.setItem('jira_password_expired', '1')
    changePassword.mockResolvedValueOnce({ message: 'Password changed successfully.' })
    render(<ChangePasswordSection />)
    expect(screen.getByText(/older than the rotation period/i)).toBeInTheDocument()

    fillAndSubmit({ current: 'oldpass1', next: 'brandnew2', confirm: 'brandnew2' })

    await waitFor(() => {
      expect(screen.queryByText(/older than the rotation period/i)).not.toBeInTheDocument()
    })
    expect(window.sessionStorage.getItem('jira_password_expired')).toBeNull()
  })
})
