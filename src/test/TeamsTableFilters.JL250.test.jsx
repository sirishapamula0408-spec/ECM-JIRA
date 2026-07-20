import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

// ── Mock the API layer TeamsPage talks to ──
vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn(),
  fetchInvitations: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  inviteMember: vi.fn(),
  resendMemberInvite: vi.fn(),
  updateProfile: vi.fn(),
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
import { fetchMembers, fetchInvitations } from '../api/memberApi'

// 12 members so the default 10-per-page slice actually hides some rows.
// Roles/statuses/task_counts vary so filters and column sorts are observable.
const MEMBERS = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0')
  return {
    id: i + 1,
    name: `Member ${n}`,
    email: `member${n}@example.com`,
    role: i === 0 ? 'Admin' : i === 1 ? 'Viewer' : 'Member',
    status: i % 4 === 0 ? 'Invited' : 'Active',
    task_count: (i * 3) % 7,
  }
})

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
  await waitFor(() => expect(screen.getByText('Member 01')).toBeInTheDocument())
}

// Body rows = the (single) members table's rows minus the header row.
function bodyRowCount() {
  return within(screen.getByRole('table')).getAllByRole('row').length - 1
}

// Ordered member names as currently rendered in the members table.
function renderedNames() {
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
  return rows.map((row) => row.querySelector('strong')?.textContent || '')
}

beforeEach(() => {
  vi.clearAllMocks()
  usePermissions.mockReturnValue({ canInviteMembers: false, isAdmin: false })
  fetchInvitations.mockResolvedValue([])
  fetchMembers.mockResolvedValue(MEMBERS)
})

describe('TeamsPage members table — search a11y (JL-250)', () => {
  it('exposes an accessible name on the members search input', async () => {
    await renderLoaded()
    const search = screen.getByLabelText('Search members')
    expect(search).toBeInTheDocument()
    expect(search.tagName).toBe('INPUT')
  })
})

describe('TeamsPage members table — pagination (JL-250)', () => {
  it('renders only the first page (default 10 rows) of a larger set', async () => {
    await renderLoaded()

    expect(bodyRowCount()).toBe(10)
    expect(screen.getByText('Member 10')).toBeInTheDocument()
    expect(screen.queryByText('Member 11')).not.toBeInTheDocument()
    expect(screen.getByText('12 of 12 members')).toBeInTheDocument()
  })

  it('navigates to the next page and shows the remaining rows', async () => {
    await renderLoaded()

    fireEvent.click(screen.getByLabelText('Go to next page'))

    expect(screen.getByText('Member 11')).toBeInTheDocument()
    expect(screen.getByText('Member 12')).toBeInTheDocument()
    expect(screen.queryByText('Member 01')).not.toBeInTheDocument()
    expect(bodyRowCount()).toBe(2)
  })
})

describe('TeamsPage members table — filters (JL-250)', () => {
  it('narrows the list by role', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'Admin' } })

    expect(bodyRowCount()).toBe(1)
    expect(screen.getByText('Member 01')).toBeInTheDocument()
    expect(screen.getByText('1 of 12 members')).toBeInTheDocument()
    // A non-Admin member is filtered out.
    expect(screen.queryByText('Member 03')).not.toBeInTheDocument()
  })

  it('narrows the list by status', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'Invited' } })

    // Invited members are ids 1, 5, 9 (i % 4 === 0) → 3 rows.
    expect(bodyRowCount()).toBe(3)
    expect(screen.getByText('3 of 12 members')).toBeInTheDocument()
  })

  it('combines the substring search with the filters', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'member 1' } })

    // "member 1" (with the space) matches Member 10, 11, 12 → 3 rows.
    expect(bodyRowCount()).toBe(3)
    expect(screen.getByText('3 of 12 members')).toBeInTheDocument()
  })
})

describe('TeamsPage members table — sorting (JL-250)', () => {
  it('reorders rows when a column header is clicked (asc → desc toggle)', async () => {
    await renderLoaded()

    // Default sort is name ascending: first visible row is Member 01.
    expect(renderedNames()[0]).toBe('Member 01')

    // Click the Member header to toggle to descending order. Scope to the
    // table so we don't collide with the "+ Invite Member" toolbar button.
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: /Member/i }))

    // Now the highest name sorts first; Member 01 drops off page 1.
    expect(renderedNames()[0]).toBe('Member 12')
    expect(screen.queryByText('Member 01')).not.toBeInTheDocument()

    // Header reflects the active sort direction for assistive tech.
    const memberHeader = screen.getByRole('columnheader', { name: /Member/i })
    expect(memberHeader).toHaveAttribute('aria-sort', 'descending')
  })
})
