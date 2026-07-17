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
