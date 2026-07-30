import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/*
 * JL-297 — Board settings UI: styling/clarity fixes.
 *   1. The workspace dropdown marks the seeded default workspace with "(default)".
 *   2. Icon-only controls carry descriptive tooltips (title) + aria-labels.
 *   3. The "Show archived" checkbox label uses the shared label typography
 *      class instead of an oversized inline font.
 */

// ── Shared context/hook mocks ──
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { email: 'sirisha@example.com' }, handleLogout: vi.fn() }),
}))
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', onThemeChange: vi.fn() }),
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ profile: null, currentMember: null }),
}))
vi.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}))
vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: [], handleMove: vi.fn() }),
}))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    canCreateIssue: true,
    canEditIssue: true,
    canManageProjectSettings: true,
    canCreateProject: true,
    isAdmin: true,
    workspaceRole: 'Admin',
  }),
}))
vi.mock('../hooks/useRecentIssues', () => ({ useRecentIssues: () => ({ recentIssues: [] }) }))
vi.mock('../hooks/usePageTitle', () => ({ usePageTitle: () => {} }))

// ── API mocks ──
vi.mock('../api/issueApi', () => ({ searchIssues: vi.fn(() => Promise.resolve([])) }))
vi.mock('../api/workspaceApi', () => ({
  DEFAULT_WORKSPACE_SLUG: 'default',
  fetchWorkspaces: vi.fn(() =>
    Promise.resolve([
      { id: 1, name: 'Acme Workspace', slug: 'default' },
      { id: 2, name: 'Skunkworks', slug: 'skunkworks' },
    ]),
  ),
  getActiveWorkspaceId: vi.fn(() => '1'),
  setActiveWorkspaceId: vi.fn(),
}))
vi.mock('../api/boardConfigApi', () => ({
  fetchBoardConfig: vi.fn(() =>
    Promise.resolve({ projectId: 1, swimlaneBy: 'none', wipLimits: {}, quickFilters: [] }),
  ),
  saveBoardConfig: vi.fn(() => Promise.resolve({})),
  ESTIMATION_STATISTIC_OPTIONS: [
    { value: 'story_points', label: 'Story Points' },
    { value: 'time_estimate', label: 'Original Time Estimate' },
    { value: 'issue_count', label: 'Issue Count' },
  ],
}))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn(() =>
    Promise.resolve([
      { id: 1, name: 'Apollo', key: 'AP', type: 'Scrum', lead: 'Ada', avatar_color: '#0052cc', archived: false },
    ]),
  ),
  deleteProject: vi.fn(),
  archiveProject: vi.fn(),
  unarchiveProject: vi.fn(),
}))
vi.mock('../api/favoriteApi', () => ({
  fetchFavorites: vi.fn(() => Promise.resolve({ projectIds: [] })),
  favoriteProject: vi.fn(),
  unfavoriteProject: vi.fn(),
}))
vi.mock('../components/notifications/NotificationDropdown', () => ({
  NotificationDropdown: () => null,
}))

import { Topbar } from '../components/layout/Topbar'
import { BoardPage } from '../pages/BoardPage/BoardPage'
import { ProjectsPage } from '../pages/ProjectsPage/ProjectsPage'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('JL-297 — workspace dropdown marks the default workspace', () => {
  it('shows "(default)" on the seeded default workspace option only', async () => {
    render(
      <MemoryRouter>
        <Topbar onCreate={vi.fn()} hasProjects />
      </MemoryRouter>,
    )

    const select = await screen.findByLabelText('Active workspace')
    const options = within(select).getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('Acme Workspace (default)')
    // Non-default workspaces stay unmarked.
    expect(options[1].textContent.trim()).toBe('Skunkworks')
    expect(options[1].textContent).not.toContain('(default)')
  })
})

describe('JL-297 — icon-only controls have tooltips and aria-labels', () => {
  it('board "More actions" icon button has an accessible name and a title tooltip', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/1/board']}>
        <Routes>
          <Route path="/projects/:projectId/board" element={<BoardPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const moreBtn = screen.getByRole('button', { name: 'More actions' })
    expect(moreBtn).toHaveAttribute('title', 'More actions')
    // The board settings panel itself stays reachable from this control set.
    fireEvent.click(screen.getAllByText('Board settings')[0])
    expect(screen.getByRole('dialog', { name: 'Board settings' })).toBeInTheDocument()
  })

  it('topbar icon-only buttons carry title tooltips matching their aria-labels', async () => {
    render(
      <MemoryRouter>
        <Topbar onCreate={vi.fn()} hasProjects />
      </MemoryRouter>,
    )

    // JL-298 replaced the inert Settings gear with a theme toggle, so it is no
    // longer a title==aria-label icon button; the rest still carry matching tooltips.
    for (const name of ['Notifications', 'Help', 'Open user menu']) {
      const btn = screen.getByRole('button', { name })
      expect(btn).toHaveAttribute('title', name)
    }
  })

  it('project row "..." icon button has an aria-label and title tooltip', async () => {
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    )

    await screen.findByText('Apollo')
    const actionsBtn = screen.getByRole('button', { name: 'Project actions' })
    expect(actionsBtn).toHaveAttribute('title', 'Project actions')
  })
})

describe('JL-297 — "Show archived" label typography', () => {
  it('uses the shared .projects-archived-toggle class with no oversized inline font', async () => {
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    )

    await screen.findByText('Apollo')
    const checkbox = screen.getByLabelText('Show archived')
    const label = checkbox.closest('label')
    expect(label).not.toBeNull()
    expect(label).toHaveClass('projects-archived-toggle')
    // The old inline 13px font override is gone — typography now comes from the
    // stylesheet token (var(--font-size-base)), consistent with sibling labels.
    expect(label.style.fontSize).toBe('')
    expect(label.getAttribute('style')).toBeNull()
  })
})
