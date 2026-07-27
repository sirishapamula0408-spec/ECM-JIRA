import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

/* ================================================================
   JL-244 — Reusable EmptyState adoption on remaining list pages
   Renders a sample of the updated pages/components with no data and
   asserts the shared <EmptyState> (role="status") is used instead of
   the old ad-hoc "no data" markup, with CTAs gated by permissions.
   ================================================================ */

// ── API mocks ──
vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn(() => Promise.resolve([])),
  fetchInvitations: vi.fn(() => Promise.resolve([])),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  resendInvitation: vi.fn(),
  deleteMember: vi.fn(),
  bulkDeleteMembers: vi.fn(),
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
vi.mock('../api/sharedDashboardApi', () => ({
  fetchSharedDashboards: vi.fn(() => Promise.resolve([])),
  createSharedDashboard: vi.fn(),
  updateSharedDashboard: vi.fn(),
  deleteSharedDashboard: vi.fn(),
  cloneSharedDashboard: vi.fn(),
}))
vi.mock('../api/listViewApi', () => ({
  fetchListViews: vi.fn(() => Promise.resolve([])),
  createListView: vi.fn(),
  updateListView: vi.fn(),
  deleteListView: vi.fn(),
  DEFAULT_COLUMNS: ['key', 'summary', 'status'],
  COLUMN_LABELS: { key: 'Key', summary: 'Summary', status: 'Status' },
}))

// ── Context / heavy-component mocks ──
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { email: 'me@example.com' } }),
}))
vi.mock('../components/dashboard/GadgetBoard', () => ({
  GadgetBoard: () => <div data-testid="gadget-board" />,
}))

// ── Control permission capabilities directly ──
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

import { TeamsPage } from '../pages/TeamsPage/TeamsPage'
import { SharedDashboardsPage } from '../pages/SharedDashboardsPage/SharedDashboardsPage'
import { ListViewControls } from '../components/listViews/ListViewControls'
import { MemberProvider } from '../context/MemberContext'
import { usePermissions } from '../hooks/usePermissions'

beforeEach(() => {
  vi.clearAllMocks()
  usePermissions.mockReturnValue({ canInviteMembers: false, isAdmin: false, canCreateIssue: false })
})

function findEmptyState(title) {
  // The shared EmptyState renders with role="status" and an h3 title.
  const region = screen
    .getAllByRole('status')
    .find((el) => el.classList.contains('empty-state') && within(el).queryByText(title))
  expect(region, `expected an <EmptyState> titled "${title}"`).toBeTruthy()
  return region
}

describe('TeamsPage — EmptyState adoption (JL-244)', () => {
  function renderPage() {
    return render(
      <BrowserRouter>
        <MemberProvider>
          <TeamsPage />
        </MemberProvider>
      </BrowserRouter>,
    )
  }

  it('renders the shared EmptyState when there are no members', async () => {
    renderPage()
    await screen.findByText('No team members yet')
    const region = findEmptyState('No team members yet')
    expect(within(region).getByText(/Invite teammates to collaborate/i)).toBeInTheDocument()
    // Old ad-hoc markup is gone.
    expect(document.querySelector('.teams-empty')).toBeNull()
    // CTA is hidden for users who cannot invite members.
    expect(within(region).queryByRole('button', { name: /Invite Member/i })).toBeNull()
  })

  it('shows an Invite Member CTA inside the EmptyState for users who can invite', async () => {
    usePermissions.mockReturnValue({ canInviteMembers: true, isAdmin: true, canCreateIssue: true })
    renderPage()
    await screen.findByText('No team members yet')
    const region = findEmptyState('No team members yet')
    const cta = within(region).getByRole('button', { name: /Invite Member/i })
    fireEvent.click(cta)
    expect(screen.getByText('Invite a new member')).toBeInTheDocument()
  })
})

describe('SharedDashboardsPage — EmptyState adoption (JL-244)', () => {
  it('renders the shared EmptyState with a permission-gated create CTA', async () => {
    usePermissions.mockReturnValue({ canCreateIssue: true })
    render(<SharedDashboardsPage />)
    await screen.findByText('No dashboards yet')
    const region = findEmptyState('No dashboards yet')
    expect(within(region).getByText(/share it with your team/i)).toBeInTheDocument()
    expect(document.querySelector('.sd-empty')).toBeNull()
    // The CTA opens the create form.
    fireEvent.click(within(region).getByRole('button', { name: /New Dashboard/i }))
    expect(screen.getByText('New Dashboard', { selector: 'h3' })).toBeInTheDocument()
  })

  it('hides the create CTA from users without create permission', async () => {
    usePermissions.mockReturnValue({ canCreateIssue: false })
    render(<SharedDashboardsPage />)
    await screen.findByText('No dashboards yet')
    const region = findEmptyState('No dashboards yet')
    expect(within(region).queryByRole('button', { name: /New Dashboard/i })).toBeNull()
  })
})

describe('ListViewControls — EmptyState adoption (JL-244)', () => {
  it('renders the shared EmptyState in the saved-views menu when there are none', async () => {
    render(<ListViewControls columns={['key', 'summary']} onColumnsChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /views/i }))
    await screen.findByText('No saved views yet')
    const region = findEmptyState('No saved views yet')
    expect(within(region).getByText(/Save the current columns/i)).toBeInTheDocument()
    expect(document.querySelector('.lvc-menu-empty')).toBeNull()
  })
})
