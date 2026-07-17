import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn(),
  fetchUserAuditLog: vi.fn(() => Promise.resolve([])),
  inviteMember: vi.fn(),
  resendMemberInvite: vi.fn(),
  updateProfile: vi.fn(),
  createMember: vi.fn(),
  updateMemberRole: vi.fn(),
  deleteMember: vi.fn(),
  bulkDeleteMembers: vi.fn(),
  deactivateMember: vi.fn(),
  reactivateMember: vi.fn(),
}))

import { UserManagementPage } from '../pages/UserManagementPage/UserManagementPage'
import { MemberProvider } from '../context/MemberContext'
import { fetchMembers, bulkDeleteMembers } from '../api/memberApi'

const MEMBERS = [
  { id: 1, name: 'Olivia Owner', email: 'owner@x.com', role: 'Owner', status: 'Active', is_owner: true },
  { id: 2, name: 'Adam Admin', email: 'adam@x.com', role: 'Admin', status: 'Active' },
  { id: 3, name: 'Mia Member', email: 'mia@x.com', role: 'Member', status: 'Active' },
  { id: 4, name: 'Vic Viewer', email: 'vic@x.com', role: 'Viewer', status: 'Active' },
]

function renderPage() {
  return render(
    <BrowserRouter>
      <MemberProvider>
        <UserManagementPage />
      </MemberProvider>
    </BrowserRouter>,
  )
}

async function renderLoaded() {
  renderPage()
  await waitFor(() => expect(screen.getByText('Mia Member')).toBeInTheDocument())
}

describe('UserManagementPage — bulk delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMembers.mockResolvedValue(MEMBERS)
  })

  it('disables selection for the Owner row but allows others', async () => {
    await renderLoaded()
    expect(screen.getByLabelText('Select Olivia Owner')).toBeDisabled()
    expect(screen.getByLabelText('Select Mia Member')).not.toBeDisabled()
  })

  it('shows the selected count when rows are checked', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByLabelText('Select Mia Member'))
    fireEvent.click(screen.getByLabelText('Select Vic Viewer'))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })

  it('select-all picks every selectable (non-owner) row on the page', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByLabelText('Select all users on this page'))
    // Owner excluded → Admin + Member + Viewer = 3.
    expect(screen.getByText('3 selected')).toBeInTheDocument()
  })

  it('deletes the selected users after confirmation', async () => {
    bulkDeleteMembers.mockResolvedValue({ deleted: [3, 4], skipped: [] })
    await renderLoaded()

    fireEvent.click(screen.getByLabelText('Select Mia Member'))
    fireEvent.click(screen.getByLabelText('Select Vic Viewer'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(bulkDeleteMembers).toHaveBeenCalledWith(expect.arrayContaining([3, 4])),
    )
    await waitFor(() => expect(screen.queryByText('Mia Member')).not.toBeInTheDocument())
    expect(screen.queryByText('Vic Viewer')).not.toBeInTheDocument()
    // Adam & Owner remain.
    expect(screen.getByText('Adam Admin')).toBeInTheDocument()
  })

  it('surfaces skipped (protected) rows and leaves them in place', async () => {
    bulkDeleteMembers.mockResolvedValue({
      deleted: [],
      skipped: [{ id: 2, reason: 'cannot delete the last remaining Admin' }],
    })
    await renderLoaded()

    fireEvent.click(screen.getByLabelText('Select Adam Admin'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(bulkDeleteMembers).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText(/skipped/i)).toBeInTheDocument())
    // The protected row is still there.
    expect(screen.getByText('Adam Admin')).toBeInTheDocument()
  })
})
