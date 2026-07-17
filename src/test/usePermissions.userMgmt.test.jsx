import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { usePermissions } from '../hooks/usePermissions'
import { RequireRole } from '../components/auth/RequireRole'
import { Sidebar } from '../components/layout/Sidebar'

// Mock MemberContext — the real usePermissions hook derives capabilities from it
vi.mock('../context/MemberContext', () => ({
  useMembers: vi.fn(),
}))

// Sidebar fetches projects on expand — stub the API module
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn(() => Promise.resolve([])),
}))

import { useMembers } from '../context/MemberContext'

function setupMember(currentMember) {
  useMembers.mockReturnValue({ currentMember })
}

const OWNER = { workspaceRole: 'Admin', isOwner: true, projectRoles: [] }
const ADMIN = { workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
const MEMBER = { workspaceRole: 'Member', isOwner: false, projectRoles: [] }
const VIEWER = { workspaceRole: 'Viewer', isOwner: false, projectRoles: [] }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('usePermissions — user management capabilities (JL-195)', () => {
  it('grants canManageUsers and canDeleteUser to workspace Owner', () => {
    setupMember(OWNER)
    const { result } = renderHook(() => usePermissions())
    expect(result.current.canManageUsers).toBe(true)
    expect(result.current.canDeleteUser).toBe(true)
  })

  it('grants canManageUsers and canDeleteUser to workspace Admin', () => {
    setupMember(ADMIN)
    const { result } = renderHook(() => usePermissions())
    expect(result.current.canManageUsers).toBe(true)
    expect(result.current.canDeleteUser).toBe(true)
  })

  it('denies canManageUsers and canDeleteUser to workspace Member', () => {
    setupMember(MEMBER)
    const { result } = renderHook(() => usePermissions())
    expect(result.current.canManageUsers).toBe(false)
    expect(result.current.canDeleteUser).toBe(false)
  })

  it('denies canManageUsers and canDeleteUser to workspace Viewer', () => {
    setupMember(VIEWER)
    const { result } = renderHook(() => usePermissions())
    expect(result.current.canManageUsers).toBe(false)
    expect(result.current.canDeleteUser).toBe(false)
  })

  it('denies both capabilities while member data is not loaded', () => {
    setupMember(null)
    const { result } = renderHook(() => usePermissions())
    expect(result.current.loaded).toBe(false)
    expect(result.current.canManageUsers).toBe(false)
    expect(result.current.canDeleteUser).toBe(false)
  })

  it('does not grant user management via a project-level Admin role alone', () => {
    setupMember({
      workspaceRole: 'Member',
      isOwner: false,
      projectRoles: [{ projectId: 1, projectKey: 'TP', role: 'Admin' }],
    })
    const { result } = renderHook(() => usePermissions(1))
    expect(result.current.canManageUsers).toBe(false)
    expect(result.current.canDeleteUser).toBe(false)
  })
})

describe('Sidebar "Users" nav link gating (JL-195)', () => {
  function renderSidebar() {
    return render(
      <MemoryRouter>
        <Sidebar
          collapsed={false}
          onToggleSidebar={() => {}}
          onCreateProject={() => {}}
          projectRefreshKey={0}
          hasProjects
        />
      </MemoryRouter>,
    )
  }

  it('shows the Users link for an Admin', () => {
    setupMember(ADMIN)
    renderSidebar()
    const link = screen.getByRole('link', { name: 'Users' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/users')
  })

  it('shows the Users link for the Owner', () => {
    setupMember(OWNER)
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument()
  })

  it('hides the Users link for a Viewer', () => {
    setupMember(VIEWER)
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()
    expect(screen.queryByText('Users')).not.toBeInTheDocument()
  })

  it('hides the Users link for a Member', () => {
    setupMember(MEMBER)
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()
  })
})

describe('/users route gating (JL-195)', () => {
  // Mirrors the App.jsx composition: RequireRole with a redirect fallback
  function StubUserManagementPage() {
    return <h1>User Management</h1>
  }

  function renderUsersRoute() {
    return render(
      <MemoryRouter initialEntries={['/users']}>
        <Routes>
          <Route path="/" element={<h1>Dashboard Home</h1>} />
          <Route
            path="/users"
            element={(
              <RequireRole permission="canManageUsers" fallback={<Navigate to="/" replace />}>
                <StubUserManagementPage />
              </RequireRole>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('renders the User Management page for an Admin', () => {
    setupMember(ADMIN)
    renderUsersRoute()
    expect(screen.getByText('User Management')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard Home')).not.toBeInTheDocument()
  })

  it('redirects a Viewer away from /users', () => {
    setupMember(VIEWER)
    renderUsersRoute()
    expect(screen.queryByText('User Management')).not.toBeInTheDocument()
    expect(screen.getByText('Dashboard Home')).toBeInTheDocument()
  })

  it('redirects a Member away from /users', () => {
    setupMember(MEMBER)
    renderUsersRoute()
    expect(screen.queryByText('User Management')).not.toBeInTheDocument()
    expect(screen.getByText('Dashboard Home')).toBeInTheDocument()
  })
})
