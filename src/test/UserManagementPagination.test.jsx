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

describe('UserManagementPage — pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMembers.mockResolvedValue(MANY)
  })

  it('renders only the first page (default 25 rows) of a larger set', async () => {
    await renderLoaded()

    expect(bodyRowCount()).toBe(25)
    expect(screen.getByText('User 25')).toBeInTheDocument()
    expect(screen.queryByText('User 26')).not.toBeInTheDocument()
    // The page's own count reflects the full (unpaginated) total.
    expect(screen.getByText('30 of 30 users')).toBeInTheDocument()
  })

  it('navigates to the next page and shows the remaining rows', async () => {
    await renderLoaded()

    fireEvent.click(screen.getByLabelText('Go to next page'))

    expect(screen.getByText('User 26')).toBeInTheDocument()
    expect(screen.getByText('User 30')).toBeInTheDocument()
    expect(screen.queryByText('User 01')).not.toBeInTheDocument()
    expect(bodyRowCount()).toBe(5)
  })

  it('re-slices when rows-per-page changes', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText('Users per page'), { target: { value: '10' } })

    expect(bodyRowCount()).toBe(10)
    expect(screen.getByText('User 10')).toBeInTheDocument()
    expect(screen.queryByText('User 11')).not.toBeInTheDocument()
  })

  it('resets to the first page when a filter changes', async () => {
    await renderLoaded()

    // Go to page 2 (rows 26–30)...
    fireEvent.click(screen.getByLabelText('Go to next page'))
    expect(screen.getByText('User 26')).toBeInTheDocument()

    // ...then filter — should jump back to page 1 of the filtered set.
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'user 0' } })

    // "user 0" matches names User 01..User 09 (9 users).
    expect(screen.getByText('User 01')).toBeInTheDocument()
    expect(screen.getByText('User 09')).toBeInTheDocument()
    expect(screen.queryByText('User 26')).not.toBeInTheDocument()
    expect(screen.getByText('9 of 30 users')).toBeInTheDocument()
    expect(bodyRowCount()).toBe(9)
  })
})
