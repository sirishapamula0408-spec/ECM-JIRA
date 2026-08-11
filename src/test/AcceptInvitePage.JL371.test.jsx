import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { AcceptInvitePage } from '../pages/AcceptInvitePage/AcceptInvitePage'
import { AuthProvider } from '../context/AuthContext'
import { acceptInvitation, lookupInvitation } from '../api/memberApi'

/**
 * JL-371 — the accept screen has to finish the job.
 *
 * Before this ticket the page redeemed the token, showed "you're now a Member",
 * and then told the invitee to go and create a password on the sign-up screen —
 * because the backend accept produced no account. The page is now where the
 * password is set and where the returned session gets installed.
 */
vi.mock('../api/memberApi', () => ({
  lookupInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
}))

const PENDING_INVITE = {
  email: 'newbie@sedintechnologies.com',
  role: 'Member',
  status: 'pending',
  expired: false,
  valid: true,
}

function renderPage(token = 'tok-371') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[`/accept-invite?token=${token}`]}>
        <AcceptInvitePage />
      </MemoryRouter>
    </AuthProvider>,
  )
}

async function waitForForm() {
  return screen.findByRole('button', { name: /accept invitation/i })
}

function typePasswords(password, confirm = password) {
  fireEvent.change(screen.getByLabelText(/choose a password/i), { target: { value: password } })
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: confirm } })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
  lookupInvitation.mockResolvedValue(PENDING_INVITE)
})

describe('AcceptInvitePage — setting a password (JL-371)', () => {
  it('offers password fields alongside the name', async () => {
    renderPage()
    await waitForForm()
    expect(screen.getByLabelText(/choose a password/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument()
  })

  it('sends the chosen password with the accept', async () => {
    acceptInvitation.mockResolvedValueOnce({
      ok: true,
      member: { id: 7, role: 'Member' },
      accountCreated: true,
      user: { id: 42, email: PENDING_INVITE.email },
      token: 'jwt-from-accept',
    })

    renderPage()
    await waitForForm()
    typePasswords('Invited123!')
    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }))

    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith('tok-371', {
        name: 'newbie',
        password: 'Invited123!',
      })
    })
  })

  it('will not submit without a password', async () => {
    renderPage()
    await waitForForm()
    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }))

    expect(await screen.findByText(/finish setting up your account/i)).toBeInTheDocument()
    expect(acceptInvitation).not.toHaveBeenCalled()
  })

  it('will not submit when the confirmation does not match', async () => {
    renderPage()
    await waitForForm()
    typePasswords('Invited123!', 'Invited124!')
    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }))

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument()
    expect(acceptInvitation).not.toHaveBeenCalled()
  })

  it('surfaces the server-side password rules rather than duplicating them', async () => {
    acceptInvitation.mockRejectedValueOnce(new Error('Password must be at least 8 characters'))

    renderPage()
    await waitForForm()
    typePasswords('abc1234')
    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }))

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
  })
})

describe('AcceptInvitePage — the returned session (JL-371)', () => {
  it('installs the session so the invitee lands signed in', async () => {
    const user = { id: 42, email: PENDING_INVITE.email }
    acceptInvitation.mockResolvedValueOnce({
      ok: true,
      member: { id: 7, role: 'Member' },
      accountCreated: true,
      user,
      token: 'jwt-from-accept',
    })

    renderPage()
    await waitForForm()
    typePasswords('Invited123!')
    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }))

    expect(await screen.findByText(/you're signed in/i)).toBeInTheDocument()
    expect(window.sessionStorage.getItem('jira_auth_token')).toBe('jwt-from-accept')
    expect(JSON.parse(window.sessionStorage.getItem('jira_auth_user'))).toEqual(user)
    // No detour via the sign-up screen — that instruction is what JL-371 removes.
    expect(screen.queryByText(/sign-up screen/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /go to your workspace/i })).toBeInTheDocument()
  })

  it('explains the existing-account case and installs no session', async () => {
    acceptInvitation.mockResolvedValueOnce({
      ok: true,
      member: { id: 7, role: 'Admin' },
      accountCreated: false,
      accountExisted: true,
      user: { id: 3, email: PENDING_INVITE.email },
      message: 'An account already exists for this email. Your role has been applied — sign in with your existing password.',
    })

    renderPage()
    await waitForForm()
    typePasswords('Invited123!')
    fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }))

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
    expect(screen.getByText(/existing password/i)).toBeInTheDocument()
    expect(window.sessionStorage.getItem('jira_auth_token')).toBeNull()
    expect(window.localStorage.getItem('jira_auth_token')).toBeNull()
    expect(screen.getByRole('button', { name: /continue to sign in/i })).toBeInTheDocument()
  })
})
