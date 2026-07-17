import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn(),
  fetchUserAuditLog: vi.fn(() => Promise.resolve([])),
  inviteMember: vi.fn(),
  resendMemberInvite: vi.fn(),
  updateProfile: vi.fn(),
}))

import { UserManagementPage } from '../pages/UserManagementPage/UserManagementPage'
import { MemberProvider } from '../context/MemberContext'
import { fetchMembers } from '../api/memberApi'

const MEMBERS = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'Admin', status: 'Active', task_count: 3 },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'Member', status: 'Active', task_count: 1 },
  { id: 3, name: 'Carol Danvers', email: 'carol@example.com', role: 'Viewer', status: 'Invited', task_count: 0 },
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
  await waitFor(() => {
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument()
  })
}

describe('UserManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMembers.mockResolvedValue(MEMBERS)
  })

  it('renders the page title and a loading state while fetching', () => {
    renderPage()
    expect(screen.getByText('User Management')).toBeInTheDocument()
    expect(screen.getByText('Loading users...')).toBeInTheDocument()
  })

  it('renders a row for every member with name, email, role, and status', async () => {
    await renderLoaded()

    expect(screen.getByText('Alice Johnson')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('Bob Smith')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
    expect(screen.getByText('Carol Danvers')).toBeInTheDocument()
    expect(screen.getByText('carol@example.com')).toBeInTheDocument()

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Admin')).toBeInTheDocument()
    expect(table.getByText('Viewer')).toBeInTheDocument()
    expect(table.getByText('Invited')).toBeInTheDocument()
    expect(screen.getByText('3 of 3 users')).toBeInTheDocument()
  })

  it('filters the list when searching by name', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'bob' } })

    expect(screen.getByText('Bob Smith')).toBeInTheDocument()
    expect(screen.queryByText('Alice Johnson')).not.toBeInTheDocument()
    expect(screen.queryByText('Carol Danvers')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 3 users')).toBeInTheDocument()
  })

  it('filters the list when searching by email', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'carol@example' } })

    expect(screen.getByText('Carol Danvers')).toBeInTheDocument()
    expect(screen.queryByText('Alice Johnson')).not.toBeInTheDocument()
    expect(screen.queryByText('Bob Smith')).not.toBeInTheDocument()
  })

  it('filters by role', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'Admin' } })

    expect(screen.getByText('Alice Johnson')).toBeInTheDocument()
    expect(screen.queryByText('Bob Smith')).not.toBeInTheDocument()
    expect(screen.queryByText('Carol Danvers')).not.toBeInTheDocument()
  })

  it('filters by status', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'Invited' } })

    expect(screen.getByText('Carol Danvers')).toBeInTheDocument()
    expect(screen.queryByText('Alice Johnson')).not.toBeInTheDocument()
    expect(screen.queryByText('Bob Smith')).not.toBeInTheDocument()
  })

  it('combines search with role/status filters', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'Active' } })
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'alice' } })

    expect(screen.getByText('Alice Johnson')).toBeInTheDocument()
    expect(screen.queryByText('Bob Smith')).not.toBeInTheDocument()
  })

  it('shows the empty state when no members match the filters', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'zzz-no-match' } })

    expect(screen.getByText('No users match your filters')).toBeInTheDocument()
    expect(screen.getByText('Try adjusting your search or clearing the role and status filters.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the empty state when the workspace has no users', async () => {
    fetchMembers.mockResolvedValue([])
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No users yet')).toBeInTheDocument()
    })
    expect(screen.getByText('Workspace users will appear here once members are invited.')).toBeInTheDocument()
  })

  it('shows an error alert when the API fails', async () => {
    fetchMembers.mockRejectedValue(new Error('Network down'))
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Network down')).toBeInTheDocument()
    })
  })
})
