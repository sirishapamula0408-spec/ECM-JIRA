import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

// ── Mock the API layer TeamsPage talks to ──
vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn(),
  fetchInvitations: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  inviteMember: vi.fn(),
  createMember: vi.fn(),
  resendMemberInvite: vi.fn(),
  updateProfile: vi.fn(),
}))
vi.mock('../api/securityPolicyApi', () => ({
  fetchSecurityPolicy: vi.fn(() => Promise.resolve(null)),
  updateSecurityPolicy: vi.fn(),
}))
vi.mock('../api/workspaceApi', () => ({
  fetchWorkspaceSettings: vi.fn(() => Promise.resolve({})),
  updateProjectCreationPolicy: vi.fn(),
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

import { TeamsPage } from '../pages/TeamsPage/TeamsPage'
import { MemberProvider } from '../context/MemberContext'
import { usePermissions } from '../hooks/usePermissions'
import {
  fetchMembers,
  fetchInvitations,
  createInvitation,
  inviteMember,
  createMember,
} from '../api/memberApi'

function renderPage() {
  return render(
    <BrowserRouter>
      <MemberProvider>
        <TeamsPage />
      </MemberProvider>
    </BrowserRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  usePermissions.mockReturnValue({ canInviteMembers: true, isAdmin: false })
  fetchMembers.mockResolvedValue([])
  fetchInvitations.mockResolvedValue([])
  createInvitation.mockResolvedValue({ id: 1, email: 'newbie@example.com', role: 'Member' })
})

describe('TeamsPage — consolidated invite flow (JL-247)', () => {
  it('the header "+ Invite Member" flow creates a token-based invitation (POST /api/invitations), not a tokenless member row', async () => {
    renderPage()
    await waitFor(() => expect(fetchMembers).toHaveBeenCalled())

    // Open the header invite panel.
    fireEvent.click(screen.getByRole('button', { name: /\+ Invite Member/i }))

    const panel = await screen.findByRole('heading', { name: /Invite a new member/i })
    const form = panel.closest('article')

    // Fill in email + role and submit.
    const emailInput = form.querySelector('input[type="email"]')
    fireEvent.change(emailInput, { target: { value: 'newbie@example.com' } })
    fireEvent.change(form.querySelector('select'), { target: { value: 'Member' } })
    fireEvent.click(form.querySelector('button[type="submit"]'))

    // The token-based invitation API is called…
    await waitFor(() =>
      expect(createInvitation).toHaveBeenCalledWith({ email: 'newbie@example.com', role: 'Member' }),
    )

    // …and the legacy tokenless member-create endpoints are NOT.
    expect(inviteMember).not.toHaveBeenCalled()
    expect(createMember).not.toHaveBeenCalled()
  })

  it('does not render a Name field in the header invite form (invitations are keyed on email only)', async () => {
    renderPage()
    await waitFor(() => expect(fetchMembers).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /\+ Invite Member/i }))
    const panel = await screen.findByRole('heading', { name: /Invite a new member/i })
    const form = panel.closest('article')

    expect(form.querySelector('input[placeholder="Full name"]')).toBeNull()
  })
})
