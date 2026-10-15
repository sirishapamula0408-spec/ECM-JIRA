import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

/* ================================================================
   JL-203 — Users page: single-line names, "Roles" column, and only the
   actions that apply to each user, as icons.

     Active       Deactivate, Delete
     Deactivated  Reactivate, Delete
     Invited      Resend invite, Delete
     Owner        none (neither deactivatable nor deletable — previously
                  shown as greyed-out buttons)
   ================================================================ */

vi.mock('../api/memberApi', () => ({
  fetchMembersPage: vi.fn(),
  fetchUserAuditLog: vi.fn(() => Promise.resolve([])),
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

import { UserManagementPage } from '../pages/UserManagementPage/UserManagementPage'
import { MemberProvider } from '../context/MemberProvider'
import { fetchMembersPage, resendMemberInvite } from '../api/memberApi'

const MEMBERS = [
  { id: 1, name: 'Olive Owner', email: 'olive@example.com', role: 'Admin', status: 'Active', is_owner: true, projectRoles: [] },
  { id: 2, name: 'Ann Active', email: 'ann@example.com', role: 'Member', status: 'Active', projectRoles: [] },
  { id: 3, name: 'Dan Deactivated', email: 'dan@example.com', role: 'Member', status: 'Deactivated', projectRoles: [] },
  { id: 4, name: 'Ivy Invited', email: 'ivy@example.com', role: 'Viewer', status: 'Invited', email_status: 'unknown', projectRoles: [] },
  { id: 5, name: 'authtest_1790311961272_with_a_very_long_name', email: 'long@example.com', role: 'Viewer', status: 'Active', projectRoles: [] },
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

const rowOf = (name) => screen.getByText(name).closest('tr')
const actionLabels = (name) =>
  within(rowOf(name).querySelector('td:last-child')).queryAllByRole('button').map((b) => b.getAttribute('aria-label'))

describe('UserManagementPage — relevant action icons (JL-203)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMembersPage.mockResolvedValue({ items: MEMBERS.map((m) => ({ ...m })), total: MEMBERS.length, limit: 25, offset: 0 })
  })

  it.each([
    ['Ann Active', ['Deactivate Ann Active', 'Delete Ann Active']],
    ['Dan Deactivated', ['Reactivate Dan Deactivated', 'Delete Dan Deactivated']],
    ['Ivy Invited', ['Resend invite to Ivy Invited', 'Delete Ivy Invited']],
    ['Olive Owner', []],
  ])('%s gets exactly the actions that apply', async (name, expected) => {
    renderPage()
    await screen.findByText(name)
    expect(actionLabels(name)).toEqual(expected)
  })

  it('shows the actions as icons, not text buttons', async () => {
    renderPage()
    await screen.findByText('Ann Active')
    const cell = rowOf('Ann Active').querySelector('td:last-child')
    expect(cell.querySelectorAll('svg')).toHaveLength(2)
    expect(within(cell).queryByText(/^(Deactivate|Delete)$/)).toBeNull()
  })

  it('labels each icon on hover', async () => {
    renderPage()
    await screen.findByText('Ivy Invited')
    fireEvent.mouseOver(screen.getByRole('button', { name: 'Resend invite to Ivy Invited' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Resend invite')
  })
})

describe('UserManagementPage — Resend invite (JL-203)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMembersPage.mockResolvedValue({ items: MEMBERS.map((m) => ({ ...m })), total: MEMBERS.length, limit: 25, offset: 0 })
  })

  it.each([
    ['sent', { email_status: 'sent' }, /Invitation resent to Ivy Invited\./],
    ['not configured', { email_status: 'skipped' }, /email delivery is not configured/],
    ['failed', { email_status: 'failed', email_error: 'mailbox unavailable' }, /could not be sent: mailbox unavailable/],
  ])('reports a %s outcome honestly', async (_label, result, message) => {
    resendMemberInvite.mockResolvedValue({ ok: result.email_status === 'sent', ...result })
    renderPage()
    await screen.findByText('Ivy Invited')
    fireEvent.click(screen.getByRole('button', { name: 'Resend invite to Ivy Invited' }))
    await waitFor(() => expect(resendMemberInvite).toHaveBeenCalledWith(4))
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('refreshes the row’s Invite email badge after a successful resend', async () => {
    resendMemberInvite.mockResolvedValue({ ok: true, email_status: 'sent' })
    renderPage()
    await screen.findByText('Ivy Invited')
    fireEvent.click(screen.getByRole('button', { name: 'Resend invite to Ivy Invited' }))
    await waitFor(() => expect(within(rowOf('Ivy Invited')).getByText(/sent/i)).toBeInTheDocument())
  })

  it('reports a request that fails outright', async () => {
    resendMemberInvite.mockRejectedValue(new Error('Only pending invitations can be resent'))
    renderPage()
    await screen.findByText('Ivy Invited')
    fireEvent.click(screen.getByRole('button', { name: 'Resend invite to Ivy Invited' }))
    expect(await screen.findByText('Only pending invitations can be resent')).toBeInTheDocument()
  })
})

describe('UserManagementPage — single-line names (JL-203)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMembersPage.mockResolvedValue({ items: MEMBERS.map((m) => ({ ...m })), total: MEMBERS.length, limit: 25, offset: 0 })
  })

  it('renders every name in the single-line style, with the full name on hover', async () => {
    renderPage()
    const longName = 'authtest_1790311961272_with_a_very_long_name'
    const el = await screen.findByText(longName)
    expect(el).toHaveClass('user-management-name')
    expect(el).toHaveAttribute('title', longName)
    expect(el.closest('td')).toHaveClass('user-management-name-td')
  })
})
