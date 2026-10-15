import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* ================================================================
   JL-205 — the top bar's "+ Create" button works again.

   RootLayout rendered <Topbar> without onCreate and hasProjects, so
   hasProjects was always undefined: the button was disabled for EVERY
   user ("No project access") and its click had nothing to call. A Member
   could not open the full Create form at all.

   The Topbar tests passed those props to <Topbar> directly, so they never
   saw that the layout dropped them. This file goes through the real
   RootLayout and Topbar. Mocks are the ProductShellIsolation.JL153 set.
   ================================================================ */

const { mockPermissions } = vi.hoisted(() => ({
  mockPermissions: {
    current: {
      canCreateIssue: true,
      canCreateIssueAnywhere: true,
      canManageMembers: true,
      canManageUsers: true,
      workspaceRole: 'Admin',
    },
  },
}))

vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => mockPermissions.current }))
vi.mock('../hooks/usePluginContributions', () => ({ usePluginContributions: () => [] }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { email: 'jane@example.com' }, handleLogout: vi.fn() }),
}))
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', onThemeChange: vi.fn() }),
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ profile: { full_name: 'Jane Doe' }, currentMember: { isOwner: false } }),
}))
vi.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({
    notifications: [], unreadCount: 0, markRead: vi.fn(), markAllRead: vi.fn(),
    dismiss: vi.fn(), clearRead: vi.fn(), loadNotifications: vi.fn(),
  }),
}))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))
vi.mock('../hooks/useRecentIssues', () => ({ useRecentIssues: () => ({ recentIssues: [] }) }))
vi.mock('../api/issueApi', () => ({ searchIssues: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([{ id: 1, name: 'Sample', key: 'SP' }]),
  fetchProjectById: vi.fn().mockResolvedValue({ id: 1, name: 'Sample', key: 'SP' }),
}))
vi.mock('../api/workspaceApi', () => ({
  fetchWorkspaces: vi.fn().mockResolvedValue([]),
  getActiveWorkspaceId: vi.fn().mockReturnValue(''),
  setActiveWorkspaceId: vi.fn(),
  DEFAULT_WORKSPACE_SLUG: 'default',
}))
vi.mock('../api/wikiSearchApi', () => ({
  searchWikiHomePages: vi.fn().mockResolvedValue({ items: [] }),
}))
vi.mock('../api/wikiHomeApi', () => ({
  fetchWikiHome: vi.fn().mockResolvedValue({
    pickUp: [], recent: [], starredPages: [], spaces: [], starredSpaces: [],
  }),
  fetchWikiFeed: vi.fn().mockResolvedValue({ items: [], hasMore: false, nextCursor: null }),
  fetchWikiList: vi.fn().mockResolvedValue({ items: [], hasMore: false, nextCursor: null }),
  recordPageView: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}))

import { RootLayout } from '../components/layout/RootLayout'

function renderShell({ onCreate = vi.fn(), hasProjects } = {}) {
  render(
    <MemoryRouter initialEntries={['/projects']}>
      <Routes>
        <Route element={<RootLayout collapsed={false} onToggleSidebar={vi.fn()} onCreate={onCreate} hasProjects={hasProjects} />}>
          <Route path="/projects" element={<h1>Projects</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  return onCreate
}

const CREATE = /^\+?\s*Create$/
const createButton = () => screen.getByRole('button', { name: CREATE })

describe('Top bar "+ Create" through RootLayout (JL-205)', () => {
  beforeEach(() => {
    mockPermissions.current = { ...mockPermissions.current, canCreateIssueAnywhere: true, workspaceRole: 'Member' }
  })

  it('is enabled for a user with a project, and opens the Create form', () => {
    const onCreate = renderShell({ hasProjects: true })
    expect(createButton()).toBeEnabled()
    fireEvent.click(createButton())
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('stays disabled, with the reason, for a user in no project', () => {
    renderShell({ hasProjects: false })
    expect(createButton()).toBeDisabled()
    expect(createButton()).toHaveAttribute('title', 'No project access')
  })

  it('is not offered to a user who may not create anywhere (a Viewer)', () => {
    mockPermissions.current = { ...mockPermissions.current, canCreateIssueAnywhere: false, workspaceRole: 'Viewer' }
    renderShell({ hasProjects: true })
    expect(screen.queryByRole('button', { name: CREATE })).toBeNull()
  })

  it('App hands RootLayout the open-Create handler and hasProjects', () => {
    // App wires a dozen providers, so its JSX is checked as source: the
    // props the top bar needs must reach RootLayout.
    const app = readFileSync(resolve(__dirname, '../App.jsx'), 'utf8')
    const rootLayout = app.slice(app.indexOf('<RootLayout'), app.indexOf('/>', app.indexOf('<RootLayout')))
    expect(rootLayout).toContain('onCreate={() => setShowCreate(true)}')
    expect(rootLayout).toContain('hasProjects={hasProjects}')
  })
})
