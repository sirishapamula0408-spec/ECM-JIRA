import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

// ── Mock the API layer TeamsPage talks to ──
vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn(),
  fetchInvitations: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
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
import { fetchMembers, fetchInvitations, revokeInvitation } from '../api/memberApi'

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
  usePermissions.mockReturnValue({ canInviteMembers: false, isAdmin: false })
  fetchInvitations.mockResolvedValue([])
})

describe('TeamsPage — loading state (JL-248)', () => {
  it('shows a loading indicator while members are being fetched, not the empty state', () => {
    fetchMembers.mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()

    expect(screen.getByText(/Loading team members/i)).toBeInTheDocument()
    expect(screen.queryByText(/No team members yet/i)).not.toBeInTheDocument()
  })
})

describe('TeamsPage — error state (JL-248)', () => {
  it('shows a distinct error state (with retry) on a failed load, never the empty state', async () => {
    fetchMembers.mockRejectedValue(new Error('Network down'))
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/Couldn't load team members/i)).toBeInTheDocument()
    })
    // The misleading empty-state message must NOT appear on error.
    expect(screen.queryByText(/No team members yet/i)).not.toBeInTheDocument()
    // A retry affordance is offered.
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument()
  })

  it('retries the load when "Try again" is clicked', async () => {
    fetchMembers.mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce([])
    renderPage()

    await waitFor(() => expect(screen.getByText(/Couldn't load team members/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }))

    await waitFor(() => expect(fetchMembers).toHaveBeenCalledTimes(2))
  })
})

describe('TeamsPage — revoke confirmation (JL-248)', () => {
  const INVITE = {
    id: 42,
    email: 'pending@example.com',
    role: 'Member',
    invited_by: 'Alice',
    expires_at: '2030-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    usePermissions.mockReturnValue({ canInviteMembers: true, isAdmin: false })
    fetchMembers.mockResolvedValue([])
    fetchInvitations.mockResolvedValue([INVITE])
  })

  it('prompts for confirmation before calling the revoke API', async () => {
    renderPage()

    // Wait for the invitation row to render.
    const revokeLink = await screen.findByRole('button', { name: 'Revoke' })
    fireEvent.click(revokeLink)

    // A confirm dialog appears naming the invitee; the API is NOT called yet.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/pending@example.com/)).toBeInTheDocument()
    expect(revokeInvitation).not.toHaveBeenCalled()

    // Confirming in the dialog performs the revoke.
    revokeInvitation.mockResolvedValue({})
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(revokeInvitation).toHaveBeenCalledWith(42))
  })
})
