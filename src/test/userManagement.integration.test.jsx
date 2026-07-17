import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

// JL-196: consolidated integration coverage for the fully-wired User Management
// epic — members render, add/role-edit/delete actions call the right API
// functions (JL-191/192/194), and the audit panel (JL-197) is surfaced on the
// page and gated to workspace Admins/Owners (JL-195).

vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn(),
  createMember: vi.fn(),
  updateMemberRole: vi.fn(),
  deleteMember: vi.fn(),
  deactivateMember: vi.fn(),
  reactivateMember: vi.fn(),
  fetchUserAuditLog: vi.fn(),
  // Imported by MemberContext at module load — never called in these tests.
  inviteMember: vi.fn(),
  resendMemberInvite: vi.fn(),
  updateProfile: vi.fn(),
}))

// Drive usePermissions directly through the member context so we can flip the
// current user's role between Admin and Viewer.
vi.mock('../context/MemberContext', () => ({
  useMembers: vi.fn(),
}))

import { UserManagementPage } from '../pages/UserManagementPage/UserManagementPage'
import {
  fetchMembers,
  createMember,
  updateMemberRole,
  deleteMember,
  fetchUserAuditLog,
} from '../api/memberApi'
import { useMembers } from '../context/MemberContext'

const ADMIN = { workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
const VIEWER = { workspaceRole: 'Viewer', isOwner: false, projectRoles: [] }

const MEMBERS = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'Admin', status: 'Active' },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'Member', status: 'Active' },
  { id: 3, name: 'Carol Danvers', email: 'carol@example.com', role: 'Viewer', status: 'Invited' },
]

const AUDIT_ROWS = [
  {
    id: 10,
    actor: 'alice@example.com',
    action: 'role_changed',
    target_email: 'zoe@example.com',
    before_value: 'Member',
    after_value: 'Admin',
    created_at: '2026-07-01T10:00:00Z',
  },
]

function renderAs(currentMember) {
  useMembers.mockReturnValue({ currentMember })
  return render(
    <BrowserRouter>
      <UserManagementPage />
    </BrowserRouter>,
  )
}

async function renderLoadedAs(currentMember) {
  renderAs(currentMember)
  await waitFor(() => {
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument()
  })
}

function rowFor(name) {
  return screen.getByText(name).closest('tr')
}

function changeRole(row, nextRole) {
  fireEvent.mouseDown(within(row).getByRole('combobox'))
  const listbox = within(screen.getByRole('listbox'))
  fireEvent.click(listbox.getByText(nextRole))
}

describe('User Management epic — integrated surface (JL-196)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMembers.mockResolvedValue(MEMBERS.map((m) => ({ ...m })))
    fetchUserAuditLog.mockResolvedValue(AUDIT_ROWS.map((r) => ({ ...r })))
  })

  it('renders a row for every workspace member', async () => {
    await renderLoadedAs(ADMIN)
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument()
    expect(screen.getByText('Bob Smith')).toBeInTheDocument()
    expect(screen.getByText('Carol Danvers')).toBeInTheDocument()
    expect(fetchMembers).toHaveBeenCalledTimes(1)
  })

  it('add-user dialog calls createMember with the form payload', async () => {
    createMember.mockResolvedValue({
      id: 4,
      name: 'Dave Lister',
      email: 'dave@example.com',
      role: 'Member',
      status: 'Invited',
    })
    await renderLoadedAs(ADMIN)

    fireEvent.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('Full name'), { target: { value: 'Dave Lister' } })
    fireEvent.change(dialog.getByLabelText('Email'), { target: { value: 'dave@example.com' } })
    fireEvent.change(dialog.getByLabelText('Role'), { target: { value: 'Member' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Add user' }))

    await waitFor(() => {
      expect(createMember).toHaveBeenCalledWith({
        name: 'Dave Lister',
        email: 'dave@example.com',
        role: 'Member',
      })
    })
    await waitFor(() => {
      expect(screen.getByText('Dave Lister')).toBeInTheDocument()
    })
  })

  it('inline role edit calls updateMemberRole', async () => {
    updateMemberRole.mockResolvedValue({
      id: 2,
      name: 'Bob Smith',
      email: 'bob@example.com',
      role: 'Admin',
      status: 'Active',
    })
    await renderLoadedAs(ADMIN)

    changeRole(rowFor('Bob Smith'), 'Admin')

    await waitFor(() => {
      expect(updateMemberRole).toHaveBeenCalledWith(2, 'Admin')
    })
  })

  it('delete action confirms and calls deleteMember', async () => {
    deleteMember.mockResolvedValue({ ok: true, id: 3 })
    await renderLoadedAs(ADMIN)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Carol Danvers' }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.click(dialog.getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(deleteMember).toHaveBeenCalledWith(3)
    })
    await waitFor(() => {
      expect(screen.queryByText('Carol Danvers')).not.toBeInTheDocument()
    })
  })

  it('surfaces the audit panel for an Admin and loads audit entries', async () => {
    await renderLoadedAs(ADMIN)

    // The collapsible "Audit log" section is present for Admins.
    const auditHeader = screen.getByText('Audit log')
    expect(auditHeader).toBeInTheDocument()

    // The mounted UserAuditLog fetches the trail on mount.
    await waitFor(() => {
      expect(fetchUserAuditLog).toHaveBeenCalled()
    })

    // Expand and confirm an audit entry renders (target email is unique to the trail).
    fireEvent.click(auditHeader)
    await waitFor(() => {
      expect(screen.getByText('zoe@example.com')).toBeInTheDocument()
    })
  })

  it('hides the audit panel from a Viewer', async () => {
    await renderLoadedAs(VIEWER)

    expect(screen.queryByText('Audit log')).not.toBeInTheDocument()
    expect(fetchUserAuditLog).not.toHaveBeenCalled()
  })
})
