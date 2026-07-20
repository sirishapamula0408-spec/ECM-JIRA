import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

// ── Mock the API layer TeamsPage talks to ──
vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn(),
  fetchInvitations: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  resendInvitation: vi.fn(),
  inviteMember: vi.fn(),
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

// ── Control permission capabilities directly ──
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

import { TeamsPage } from '../pages/TeamsPage/TeamsPage'
import { MemberProvider } from '../context/MemberContext'
import { usePermissions } from '../hooks/usePermissions'
import { fetchMembers, fetchInvitations, resendInvitation } from '../api/memberApi'

function renderPage() {
  return render(
    <BrowserRouter>
      <MemberProvider>
        <TeamsPage />
      </MemberProvider>
    </BrowserRouter>,
  )
}

const EXPIRED_INVITE = {
  id: 7,
  email: 'stale@example.com',
  role: 'Member',
  invited_by: 'Alice',
  expires_at: '2000-01-01T00:00:00.000Z',
  expired: true,
}

const LIVE_INVITE = {
  id: 8,
  email: 'fresh@example.com',
  role: 'Member',
  invited_by: 'Alice',
  expires_at: '2099-01-01T00:00:00.000Z',
  expired: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  usePermissions.mockReturnValue({ canInviteMembers: true, isAdmin: false })
  fetchMembers.mockResolvedValue([])
  fetchInvitations.mockResolvedValue([EXPIRED_INVITE, LIVE_INVITE])
})

describe('TeamsPage invitations — expired badge + resend (JL-251)', () => {
  it('shows an Expired badge only on the expired pending invite', async () => {
    renderPage()
    // Both invite rows render.
    expect(await screen.findByText('stale@example.com')).toBeInTheDocument()
    expect(screen.getByText('fresh@example.com')).toBeInTheDocument()
    // Exactly one Expired badge, for the stale invite.
    const badges = screen.getAllByText('Expired')
    expect(badges).toHaveLength(1)
  })

  it('resends an invite and refreshes the list', async () => {
    resendInvitation.mockResolvedValue({ id: 9 })
    renderPage()

    await screen.findByText('stale@example.com')
    // Each pending invite exposes a Resend button.
    const resendButtons = screen.getAllByRole('button', { name: /Resend/i })
    expect(resendButtons.length).toBeGreaterThanOrEqual(1)

    fireEvent.click(resendButtons[0])
    await waitFor(() => expect(resendInvitation).toHaveBeenCalledWith(7))
    // List reloaded: initial load + reload after resend.
    await waitFor(() => expect(fetchInvitations).toHaveBeenCalledTimes(2))
  })
})
