// JL-445 — the workspace switcher only appears when there is a workspace to
// switch TO.
//
// It used to render on `workspaces.length > 0`, so with the single seeded
// "Default Workspace" it was a label plus a dropdown holding one option: about
// 200px of header offering no choice, squeezing the search field next to it.
//
// It is GATED rather than deleted, and that distinction is the whole point of
// this file. JL-73 built multi-tenant workspace support, and Topbar.jsx is the
// only place in the app that calls setActiveWorkspaceId — deleting the markup
// would strand a second workspace with no way to reach it. So there are two
// assertions here, and the second matters more than the first: hidden at one,
// BACK at two.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The list the mocked API returns; each test sets it before rendering.
let mockWorkspaces = []

vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ profile: { full_name: 'Test User' }, currentMember: null }),
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { email: 'test@example.com' }, handleLogout: vi.fn() }),
}))
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', onThemeChange: vi.fn() }),
}))
vi.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}))
vi.mock('../hooks/useRecentIssues', () => ({
  useRecentIssues: () => ({ recentIssues: [] }),
}))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ canCreateIssueAnywhere: true, workspaceRole: 'Admin' }),
}))
vi.mock('../api/issueApi', () => ({
  searchIssues: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/workspaceApi', () => ({
  DEFAULT_WORKSPACE_SLUG: 'default',
  fetchWorkspaces: vi.fn(() => Promise.resolve(mockWorkspaces)),
  getActiveWorkspaceId: () => '1',
  setActiveWorkspaceId: vi.fn(),
}))
vi.mock('../components/notifications/NotificationDropdown', () => ({
  NotificationDropdown: () => null,
}))

import { Topbar } from '../components/layout/Topbar'

const renderTopbar = () =>
  render(
    <MemoryRouter>
      <Topbar onCreate={vi.fn()} hasProjects />
    </MemoryRouter>,
  )

describe('JL-445 — the workspace switcher is gated on having a choice', () => {
  beforeEach(() => {
    mockWorkspaces = []
  })

  it('is hidden when only one workspace exists', async () => {
    mockWorkspaces = [{ id: 1, name: 'Default Workspace', slug: 'default' }]
    renderTopbar()

    // The fetch resolves asynchronously; wait for something that only appears
    // once it has, so this cannot pass by racing the effect.
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search issues or jql/i)).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Active workspace')).toBeNull()
    expect(screen.queryByText('Workspace')).toBeNull()
  })

  it('is hidden when the workspace list is empty', async () => {
    mockWorkspaces = []
    renderTopbar()
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search issues or jql/i)).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Active workspace')).toBeNull()
  })

  it('comes BACK as soon as a second workspace exists', async () => {
    // The assertion that stops this being a deletion. If someone later swaps
    // the gate for `false`, or removes the markup, this fails.
    mockWorkspaces = [
      { id: 1, name: 'Default Workspace', slug: 'default' },
      { id: 2, name: 'Acme', slug: 'acme' },
    ]
    renderTopbar()

    const select = await screen.findByLabelText('Active workspace')
    expect(select).toBeInTheDocument()
    const options = select.querySelectorAll('option')
    expect(options).toHaveLength(2)
    // JL-297's marker survives the gate.
    expect(options[0]).toHaveTextContent('Default Workspace (default)')
    expect(options[1].textContent).not.toContain('(default)')
  })
})
