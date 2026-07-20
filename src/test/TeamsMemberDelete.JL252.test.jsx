import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
  deleteMember: vi.fn(),
  bulkDeleteMembers: vi.fn(),
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
import { fetchMembers, fetchInvitations, deleteMember, bulkDeleteMembers } from '../api/memberApi'

const MEMBERS = [
  { id: 1, name: 'Alice Admin', email: 'alice@example.com', role: 'Admin', status: 'Active', task_count: 2 },
  { id: 2, name: 'Bob Member', email: 'bob@example.com', role: 'Member', status: 'Active', task_count: 0 },
  { id: 3, name: 'Carol Member', email: 'carol@example.com', role: 'Member', status: 'Active', task_count: 1 },
]

function renderPage() {
  return render(
    <BrowserRouter>
      <MemberProvider>
        <TeamsPage />
      </MemberProvider>
    </BrowserRouter>,
  )
}

async function renderLoaded() {
  renderPage()
  await waitFor(() => expect(screen.getByText('Alice Admin')).toBeInTheDocument())
}

beforeEach(() => {
  vi.clearAllMocks()
  usePermissions.mockReturnValue({ canInviteMembers: false, isAdmin: true })
  fetchInvitations.mockResolvedValue([])
  fetchMembers.mockResolvedValue(MEMBERS)
})

describe('TeamsPage member delete — single (JL-252)', () => {
  it('confirms then calls deleteMember with the member id', async () => {
    deleteMember.mockResolvedValue({})
    await renderLoaded()

    // Open the confirm dialog from the row action; the API is not called yet.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Bob Member' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/bob@example.com/)).toBeInTheDocument()
    expect(deleteMember).not.toHaveBeenCalled()

    // Confirming performs the delete and reloads the member list.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(deleteMember).toHaveBeenCalledWith(2))
    await waitFor(() => expect(fetchMembers).toHaveBeenCalledTimes(2))
  })
})

describe('TeamsPage member delete — bulk (JL-252)', () => {
  it('deletes the selected members and passes their ids to bulkDeleteMembers', async () => {
    bulkDeleteMembers.mockResolvedValue({ deleted: [2, 3], skipped: [] })
    await renderLoaded()

    // Select Bob and Carol via their row checkboxes.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bob Member' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Carol Member' }))

    // The bulk toolbar surfaces the count and triggers the confirm dialog.
    fireEvent.click(screen.getByRole('button', { name: /Delete 2 members/ }))
    const dialog = await screen.findByRole('dialog')
    expect(bulkDeleteMembers).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(bulkDeleteMembers).toHaveBeenCalledTimes(1))
    expect(bulkDeleteMembers.mock.calls[0][0].sort()).toEqual([2, 3])
  })

  it('select-all on the page selects every non-owner row', async () => {
    bulkDeleteMembers.mockResolvedValue({ deleted: [1, 2, 3], skipped: [] })
    await renderLoaded()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all members on this page' }))
    fireEvent.click(screen.getByRole('button', { name: /Delete 3 members/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(bulkDeleteMembers).toHaveBeenCalledTimes(1))
    expect(bulkDeleteMembers.mock.calls[0][0].sort()).toEqual([1, 2, 3])
  })

  it('surfaces the skipped summary from the bulk result', async () => {
    bulkDeleteMembers.mockResolvedValue({ deleted: [2], skipped: [{ id: 3, reason: 'last_admin' }] })
    await renderLoaded()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bob Member' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Carol Member' }))
    fireEvent.click(screen.getByRole('button', { name: /Delete 2 members/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(screen.getByText(/Deleted 1 member, skipped 1 \(Owner \/ last Admin\)/)).toBeInTheDocument(),
    )
  })
})

describe('TeamsPage member delete — gating (JL-252)', () => {
  it('renders no checkboxes or delete controls for non-admins', async () => {
    usePermissions.mockReturnValue({ canInviteMembers: false, isAdmin: false })
    await renderLoaded()

    expect(screen.queryByRole('checkbox', { name: 'Select all members on this page' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select Bob Member' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Bob Member' })).not.toBeInTheDocument()
  })
})
