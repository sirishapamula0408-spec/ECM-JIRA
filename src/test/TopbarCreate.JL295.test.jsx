// JL-295 — Topbar global "+ Create" button eligibility. The button is gated on
// canCreateIssueAnywhere (workspace rank OR any project role >= Member), so a
// workspace Viewer who is a project Member/Lead sees Create, while a pure
// workspace Viewer (no project write role) does not. Uses the REAL
// usePermissions hook with a mocked MemberContext.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Context mocks (mutated per test via mockCurrentMember) ──
let mockCurrentMember = null

vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    profile: { full_name: 'Vera Viewer' },
    currentMember: mockCurrentMember,
  }),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    authUser: { email: 'vera@test.com' },
    handleLogout: vi.fn(),
  }),
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

// ── API mocks ──
vi.mock('../api/issueApi', () => ({
  searchIssues: vi.fn().mockResolvedValue([]),
}))

vi.mock('../api/workspaceApi', () => ({
  fetchWorkspaces: vi.fn().mockResolvedValue([]),
  getActiveWorkspaceId: () => '',
  setActiveWorkspaceId: vi.fn(),
}))

vi.mock('../components/notifications/NotificationDropdown', () => ({
  NotificationDropdown: () => null,
}))

import { Topbar } from '../components/layout/Topbar'
import { usePermissions } from '../hooks/usePermissions'

function renderTopbar() {
  return render(
    <MemoryRouter>
      <Topbar onCreate={vi.fn()} hasProjects={true} />
    </MemoryRouter>,
  )
}

const createButton = () => screen.queryByRole('button', { name: /create/i })

describe('JL-295 — Topbar Create button eligibility', () => {
  beforeEach(() => {
    mockCurrentMember = null
  })

  it('workspace Viewer who is a project Member sees Create', () => {
    mockCurrentMember = {
      workspaceRole: 'Viewer',
      isOwner: false,
      projectRoles: [{ projectId: 1, projectKey: 'TP', role: 'Member' }],
    }
    renderTopbar()
    expect(createButton()).toBeInTheDocument()
  })

  it('workspace Viewer who is a project Lead sees Create', () => {
    mockCurrentMember = {
      workspaceRole: 'Viewer',
      isOwner: false,
      projectRoles: [{ projectId: 2, projectKey: 'TQ', role: 'Lead' }],
    }
    renderTopbar()
    expect(createButton()).toBeInTheDocument()
  })

  it('pure workspace Viewer (no project roles) does NOT see Create', () => {
    mockCurrentMember = {
      workspaceRole: 'Viewer',
      isOwner: false,
      projectRoles: [],
    }
    renderTopbar()
    expect(createButton()).not.toBeInTheDocument()
  })

  it('workspace Viewer with only project Viewer roles does NOT see Create', () => {
    mockCurrentMember = {
      workspaceRole: 'Viewer',
      isOwner: false,
      projectRoles: [{ projectId: 1, projectKey: 'TP', role: 'Viewer' }],
    }
    renderTopbar()
    expect(createButton()).not.toBeInTheDocument()
  })

  it('workspace Member sees Create even with no project roles', () => {
    mockCurrentMember = {
      workspaceRole: 'Member',
      isOwner: false,
      projectRoles: [],
    }
    renderTopbar()
    expect(createButton()).toBeInTheDocument()
  })

  it('does not render Create while membership is still loading', () => {
    mockCurrentMember = null
    renderTopbar()
    expect(createButton()).not.toBeInTheDocument()
  })
})

describe('JL-295 — usePermissions.canCreateIssueAnywhere', () => {
  it('true for workspace Viewer with a project Member role (but canCreateIssue stays false without projectId)', () => {
    mockCurrentMember = {
      workspaceRole: 'Viewer',
      isOwner: false,
      projectRoles: [{ projectId: 1, projectKey: 'TP', role: 'Member' }],
    }
    const { result } = renderHook(() => usePermissions())
    expect(result.current.canCreateIssue).toBe(false)
    expect(result.current.canCreateIssueAnywhere).toBe(true)
  })

  it('false for a pure workspace Viewer — no privilege escalation', () => {
    mockCurrentMember = {
      workspaceRole: 'Viewer',
      isOwner: false,
      projectRoles: [{ projectId: 1, projectKey: 'TP', role: 'Viewer' }],
    }
    const { result } = renderHook(() => usePermissions())
    expect(result.current.canCreateIssueAnywhere).toBe(false)
  })

  it('true for workspace Member/Admin/Owner regardless of project roles', () => {
    mockCurrentMember = { workspaceRole: 'Member', isOwner: false, projectRoles: [] }
    expect(renderHook(() => usePermissions()).result.current.canCreateIssueAnywhere).toBe(true)

    mockCurrentMember = { workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
    expect(renderHook(() => usePermissions()).result.current.canCreateIssueAnywhere).toBe(true)

    mockCurrentMember = { workspaceRole: 'Viewer', isOwner: true, projectRoles: [] }
    expect(renderHook(() => usePermissions()).result.current.canCreateIssueAnywhere).toBe(true)
  })

  it('false while member data is not loaded', () => {
    mockCurrentMember = null
    const { result } = renderHook(() => usePermissions())
    expect(result.current.loaded).toBe(false)
    expect(result.current.canCreateIssueAnywhere).toBe(false)
  })
})
