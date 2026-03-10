import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TeamsPage } from '../pages/TeamsPage/TeamsPage'

vi.mock('../context/MemberContext', () => ({
  useMembers: vi.fn(),
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

import { useMembers } from '../context/MemberContext'
import { usePermissions } from '../hooks/usePermissions'

const mockMembers = [
  { id: 1, name: 'Alice Admin', email: 'alice@test.com', role: 'Admin', status: 'Active', task_count: 5 },
  { id: 2, name: 'Bob Member', email: 'bob@test.com', role: 'Member', status: 'Invited', task_count: 0, invited_by: 'Alice' },
]

function setupMocks(permOverrides = {}) {
  useMembers.mockReturnValue({
    profile: { full_name: 'Alice Admin' },
    members: mockMembers,
    handleInviteMember: vi.fn(),
    handleResendInvite: vi.fn(),
  })
  usePermissions.mockReturnValue({
    loaded: true,
    canInviteMembers: false,
    canManageMembers: false,
    ...permOverrides,
  })
}

describe('TeamsPage RBAC', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should show Invite Member button when canInviteMembers', () => {
    setupMocks({ canInviteMembers: true })
    render(<TeamsPage />)
    expect(screen.getByText('Invite Member')).toBeInTheDocument()
  })

  it('should hide Invite Member button when cannot invite', () => {
    setupMocks({ canInviteMembers: false })
    render(<TeamsPage />)
    expect(screen.queryByText('Invite Member')).not.toBeInTheDocument()
  })

  it('should show Resend Invite for invited members when canManageMembers', () => {
    setupMocks({ canManageMembers: true })
    render(<TeamsPage />)
    expect(screen.getByText('Resend Invite')).toBeInTheDocument()
  })

  it('should hide Resend Invite when cannot manage members', () => {
    setupMocks({ canManageMembers: false })
    render(<TeamsPage />)
    expect(screen.queryByText('Resend Invite')).not.toBeInTheDocument()
  })

  it('should always show member list regardless of permissions', () => {
    setupMocks({ canInviteMembers: false, canManageMembers: false })
    render(<TeamsPage />)
    expect(screen.getByText('Alice Admin')).toBeInTheDocument()
    expect(screen.getByText('Bob Member')).toBeInTheDocument()
  })

  it('should show role chips for all members', () => {
    setupMocks()
    render(<TeamsPage />)
    expect(screen.getByText('Admin')).toBeInTheDocument()
    // "Member" appears as table header and chip — use getAllByText
    const memberTexts = screen.getAllByText('Member')
    expect(memberTexts.length).toBeGreaterThanOrEqual(2) // header + chip
  })
})
