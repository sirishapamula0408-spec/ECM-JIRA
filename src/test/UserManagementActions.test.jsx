import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn(),
  createMember: vi.fn(),
  updateMemberRole: vi.fn(),
  deleteMember: vi.fn(),
  deactivateMember: vi.fn(),
  reactivateMember: vi.fn(),
}))

import { UserManagementPage } from '../pages/UserManagementPage/UserManagementPage'
import {
  fetchMembers,
  createMember,
  updateMemberRole,
  deleteMember,
} from '../api/memberApi'

const MEMBERS = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'Admin', status: 'Active', task_count: 3 },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'Member', status: 'Active', task_count: 1 },
  { id: 3, name: 'Carol Danvers', email: 'carol@example.com', role: 'Viewer', status: 'Invited', task_count: 0 },
]

function renderPage() {
  return render(
    <BrowserRouter>
      <UserManagementPage />
    </BrowserRouter>,
  )
}

async function renderLoaded() {
  renderPage()
  await waitFor(() => {
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument()
  })
}

function rowFor(name) {
  return screen.getByText(name).closest('tr')
}

// Change an MUI <Select> in a table row to a new option.
function changeRole(row, nextRole) {
  fireEvent.mouseDown(within(row).getByRole('combobox'))
  const listbox = within(screen.getByRole('listbox'))
  fireEvent.click(listbox.getByText(nextRole))
}

describe('UserManagementPage actions (JL-194)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMembers.mockResolvedValue(MEMBERS.map((m) => ({ ...m })))
  })

  it('opens the add-user dialog and calls createMember on submit', async () => {
    createMember.mockResolvedValue({
      id: 4,
      name: 'Dave Lister',
      email: 'dave@example.com',
      role: 'Member',
      status: 'Invited',
    })
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Add user' }))

    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('Full name'), { target: { value: 'Dave Lister' } })
    fireEvent.change(dialog.getByLabelText('Email'), { target: { value: 'dave@example.com' } })
    fireEvent.change(dialog.getByLabelText('Role'), { target: { value: 'Member' } })

    // Submit the dialog form (the dialog's own "Add user" submit button).
    fireEvent.click(dialog.getByRole('button', { name: 'Add user' }))

    await waitFor(() => {
      expect(createMember).toHaveBeenCalledWith({
        name: 'Dave Lister',
        email: 'dave@example.com',
        role: 'Member',
      })
    })
    // New row appears in the table.
    await waitFor(() => {
      expect(screen.getByText('Dave Lister')).toBeInTheDocument()
    })
  })

  it('changes a role inline and calls updateMemberRole, updating the row', async () => {
    updateMemberRole.mockResolvedValue({
      id: 2,
      name: 'Bob Smith',
      email: 'bob@example.com',
      role: 'Admin',
      status: 'Active',
    })
    await renderLoaded()

    changeRole(rowFor('Bob Smith'), 'Admin')

    await waitFor(() => {
      expect(updateMemberRole).toHaveBeenCalledWith(2, 'Admin')
    })
    // The row now reflects the new role.
    await waitFor(() => {
      expect(within(rowFor('Bob Smith')).getByText('Admin')).toBeInTheDocument()
    })
  })

  it('confirms and calls deleteMember, removing the row', async () => {
    deleteMember.mockResolvedValue({ ok: true, id: 3 })
    await renderLoaded()

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

  it('surfaces a guard failure (403) and leaves the role unchanged', async () => {
    const err = new Error('Cannot demote the last remaining Admin')
    err.status = 403
    updateMemberRole.mockRejectedValue(err)
    await renderLoaded()

    changeRole(rowFor('Alice Johnson'), 'Member')

    await waitFor(() => {
      expect(updateMemberRole).toHaveBeenCalledWith(1, 'Member')
    })
    // Error message shown to the user.
    await waitFor(() => {
      expect(screen.getByText('Cannot demote the last remaining Admin')).toBeInTheDocument()
    })
    // Role rolled back to Admin (unchanged).
    await waitFor(() => {
      expect(within(rowFor('Alice Johnson')).getByText('Admin')).toBeInTheDocument()
    })
    expect(within(rowFor('Alice Johnson')).queryByText('Member')).not.toBeInTheDocument()
  })
})
