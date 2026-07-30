import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

vi.mock('../api/memberApi', () => ({
  fetchMembersPage: vi.fn(),
  fetchUserAuditLog: vi.fn(() => Promise.resolve([])),
  inviteMember: vi.fn(),
  resendMemberInvite: vi.fn(),
  updateProfile: vi.fn(),
}))

import { UserManagementPage } from '../pages/UserManagementPage/UserManagementPage'
import { MemberProvider } from '../context/MemberContext'
import { fetchMembersPage } from '../api/memberApi'

// 30 members: "User 01".."User 30"; only "User 01" is Admin, rest Members.
const MANY = Array.from({ length: 30 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0')
  return {
    id: i + 1,
    name: `User ${n}`,
    email: `user${n}@example.com`,
    role: i === 0 ? 'Admin' : 'Member',
    status: 'Active',
    task_count: 0,
  }
})

// JL-281: server-side paging stub — filters + slices the requested window and
// returns the { items, total, limit, offset } envelope.
function pageFrom(dataset, { search, role, status, limit = 25, offset = 0 } = {}) {
  let rows = dataset
  if (search) {
    const q = String(search).toLowerCase()
    rows = rows.filter(
      (u) =>
        (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q),
    )
  }
  if (role && role !== 'all') rows = rows.filter((u) => u.role === role)
  if (status && status !== 'all') rows = rows.filter((u) => u.status === status)
  const total = rows.length
  const items = rows.slice(offset, offset + limit).map((m) => ({ ...m }))
  return { items, total, limit, offset }
}

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
  await waitFor(() => expect(screen.getByText('User 01')).toBeInTheDocument())
}

// Body rows = all table rows minus the header row.
function bodyRowCount() {
  return within(screen.getByRole('table')).getAllByRole('row').length - 1
}

describe('UserManagementPage — server-side pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMembersPage.mockImplementation((params) => Promise.resolve(pageFrom(MANY, params)))
  })

  it('renders only the first page (default 25 rows) of a larger set', async () => {
    await renderLoaded()

    expect(bodyRowCount()).toBe(25)
    expect(screen.getByText('User 25')).toBeInTheDocument()
    expect(screen.queryByText('User 26')).not.toBeInTheDocument()
    // The count reflects the server's total for the (unfiltered) set.
    expect(screen.getByText('30 users')).toBeInTheDocument()
    // First request asked for limit 25, offset 0.
    expect(fetchMembersPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, offset: 0 }),
    )
  })

  it('requests and shows the next page of rows', async () => {
    await renderLoaded()

    fireEvent.click(screen.getByLabelText('Go to next page'))

    await waitFor(() => expect(screen.getByText('User 26')).toBeInTheDocument())
    expect(screen.getByText('User 30')).toBeInTheDocument()
    expect(screen.queryByText('User 01')).not.toBeInTheDocument()
    expect(bodyRowCount()).toBe(5)
    // Second page → offset 25.
    expect(fetchMembersPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, offset: 25 }),
    )
  })

  it('re-requests with a new limit when rows-per-page changes', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText('Users per page'), { target: { value: '10' } })

    await waitFor(() => expect(bodyRowCount()).toBe(10))
    expect(screen.getByText('User 10')).toBeInTheDocument()
    expect(screen.queryByText('User 11')).not.toBeInTheDocument()
    expect(fetchMembersPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 0 }),
    )
  })

  it('resets to the first page when a filter changes', async () => {
    await renderLoaded()

    // Go to page 2 (rows 26–30)...
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(screen.getByText('User 26')).toBeInTheDocument())

    // ...then filter — should jump back to page 1 of the filtered set.
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'user 0' } })

    // "user 0" matches names User 01..User 09 (9 users).
    await waitFor(() => expect(screen.getByText('User 01')).toBeInTheDocument())
    expect(screen.getByText('User 09')).toBeInTheDocument()
    expect(screen.queryByText('User 26')).not.toBeInTheDocument()
    expect(screen.getByText('9 users')).toBeInTheDocument()
    expect(bodyRowCount()).toBe(9)
  })
})
