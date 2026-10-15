import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

/* ================================================================
   JL-204 — User Management: the Audit log pages through the whole trail,
   and the users table no longer has the Roles column.
   ================================================================ */

vi.mock('../api/memberApi', () => ({
  fetchMembersPage: vi.fn(),
  fetchUserAuditLog: vi.fn(),
  createMember: vi.fn(),
  updateMemberRole: vi.fn(),
  deleteMember: vi.fn(),
  bulkDeleteMembers: vi.fn(),
  deactivateMember: vi.fn(),
  reactivateMember: vi.fn(),
  resendMemberInvite: vi.fn(),
  inviteMember: vi.fn(),
  updateProfile: vi.fn(),
}))

import UserAuditLog from '../components/users/UserAuditLog.jsx'
import { UserManagementPage } from '../pages/UserManagementPage/UserManagementPage'
import { MemberProvider } from '../context/MemberProvider'
import { fetchUserAuditLog, fetchMembersPage } from '../api/memberApi'

const TOTAL = 222
// The server's paging: newest first, ids TOTAL..1.
function pageOf({ limit = 25, offset = 0, action } = {}) {
  const all = Array.from({ length: action ? 13 : TOTAL }, (_, i) => ({
    id: TOTAL - i,
    actor: 'admin@example.com',
    target_member_id: 9,
    target_email: `user${TOTAL - i}@example.com`,
    action: action || 'role_changed',
    before_value: 'Viewer',
    after_value: 'Member',
    created_at: '2026-10-01T00:00:00Z',
  }))
  return Promise.resolve({ items: all.slice(offset, offset + limit), total: all.length, limit, offset })
}

const lastCall = () => fetchUserAuditLog.mock.calls.at(-1)[0]

describe('UserAuditLog — paging (JL-204)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchUserAuditLog.mockImplementation(pageOf)
  })

  it('asks for the first page and shows the range out of the total', async () => {
    render(<UserAuditLog />)
    expect(await screen.findByText('user222@example.com')).toBeInTheDocument()
    expect(lastCall()).toMatchObject({ limit: 25, offset: 0 })
    expect(screen.getByText(`1–25 of ${TOTAL}`)).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(26) // header + 25
  })

  it('reaches the oldest entries — they were unreachable before', async () => {
    render(<UserAuditLog />)
    await screen.findByText('user222@example.com')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /entries per page/i }))
    fireEvent.click(await screen.findByRole('option', { name: '100' }))
    await waitFor(() => expect(lastCall()).toMatchObject({ limit: 100, offset: 0 }))
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    }
    await waitFor(() => expect(lastCall()).toMatchObject({ limit: 100, offset: 200 }))
    expect(await screen.findByText('user1@example.com')).toBeInTheDocument()
    expect(screen.getByText(`201–${TOTAL} of ${TOTAL}`)).toBeInTheDocument()
  })

  it('goes back to the first page when a filter changes', async () => {
    render(<UserAuditLog />)
    await screen.findByText('user222@example.com')
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    await waitFor(() => expect(lastCall()).toMatchObject({ offset: 25 }))

    fireEvent.change(screen.getByLabelText('Target email or id'), { target: { value: 'user5@example.com' } })
    await waitFor(() => expect(lastCall()).toMatchObject({ target: 'user5@example.com', offset: 0 }))
  })

  it('pages a filtered list against the filtered total', async () => {
    render(<UserAuditLog />)
    await screen.findByText('user222@example.com')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /^action$/i }))
    const listbox = await screen.findByRole('listbox')
    fireEvent.click(within(listbox).getAllByRole('option')[1])
    await waitFor(() => expect(lastCall().action).toBeTruthy())
    expect(await screen.findByText('1–13 of 13')).toBeInTheDocument()
  })
})

describe('UserManagementPage — no Roles column (JL-204)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchUserAuditLog.mockImplementation(pageOf)
    fetchMembersPage.mockResolvedValue({
      items: [{ id: 2, name: 'Ann Active', email: 'ann@example.com', role: 'Member', status: 'Active', projectRoles: [{ projectId: 4, projectKey: 'OICL', projectName: 'OICL', role: 'Admin' }] }],
      total: 1, limit: 25, offset: 0,
    })
  })

  it('shows no Roles / Projects & roles column and no project chips', async () => {
    render(
      <BrowserRouter>
        <MemberProvider>
          <UserManagementPage />
        </MemberProvider>
      </BrowserRouter>,
    )
    await screen.findByText('Ann Active')
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent.trim())
    expect(headers).toContain('System role')
    expect(headers.some((h) => /^(roles|projects & roles)$/i.test(h))).toBe(false)
    expect(screen.queryByText('OICL · Admin')).toBeNull()
  })
})
