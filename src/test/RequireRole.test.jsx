import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireRole } from '../components/auth/RequireRole'

// Mock usePermissions
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

import { usePermissions } from '../hooks/usePermissions'

function setupPermissions(overrides = {}) {
  usePermissions.mockReturnValue({
    loaded: true,
    workspaceRole: 'Member',
    projectRole: null,
    isOwner: false,
    isAdmin: false,
    canCreateIssue: true,
    canEditIssue: true,
    canDeleteIssue: false,
    canManageSprints: false,
    canManageProjectSettings: false,
    canManageMembers: false,
    canInviteMembers: false,
    canDeleteProject: false,
    canCreateProject: true,
    canEditWorkflows: false,
    canAddComment: true,
    ...overrides,
  })
}

describe('RequireRole', () => {
  describe('role-based gating', () => {
    it('should render children when user has required role', () => {
      setupPermissions({ workspaceRole: 'Admin', isAdmin: true })
      render(
        <RequireRole role="Admin">
          <button>Delete</button>
        </RequireRole>,
      )
      expect(screen.getByText('Delete')).toBeInTheDocument()
    })

    it('should hide children when user lacks required role', () => {
      setupPermissions({ workspaceRole: 'Viewer' })
      render(
        <RequireRole role="Admin">
          <button>Delete</button>
        </RequireRole>,
      )
      expect(screen.queryByText('Delete')).not.toBeInTheDocument()
    })

    it('should allow higher roles (Admin passes Member check)', () => {
      setupPermissions({ workspaceRole: 'Admin' })
      render(
        <RequireRole role="Member">
          <button>Create</button>
        </RequireRole>,
      )
      expect(screen.getByText('Create')).toBeInTheDocument()
    })

    it('should always allow Owner', () => {
      setupPermissions({ workspaceRole: 'Admin', isOwner: true })
      render(
        <RequireRole role="Admin">
          <button>Owner Action</button>
        </RequireRole>,
      )
      expect(screen.getByText('Owner Action')).toBeInTheDocument()
    })
  })

  describe('permission-based gating', () => {
    it('should render when permission is true', () => {
      setupPermissions({ canManageSprints: true })
      render(
        <RequireRole permission="canManageSprints">
          <button>Start Sprint</button>
        </RequireRole>,
      )
      expect(screen.getByText('Start Sprint')).toBeInTheDocument()
    })

    it('should hide when permission is false', () => {
      setupPermissions({ canManageSprints: false })
      render(
        <RequireRole permission="canManageSprints">
          <button>Start Sprint</button>
        </RequireRole>,
      )
      expect(screen.queryByText('Start Sprint')).not.toBeInTheDocument()
    })
  })

  describe('disable mode', () => {
    it('should render disabled children with tooltip when unauthorized', () => {
      setupPermissions({ canManageSprints: false })
      render(
        <RequireRole permission="canManageSprints" mode="disable">
          <button>Start Sprint</button>
        </RequireRole>,
      )
      const button = screen.getByText('Start Sprint')
      expect(button).toBeInTheDocument()
      expect(button).toBeDisabled()
    })

    it('should render enabled children when authorized', () => {
      setupPermissions({ canManageSprints: true })
      render(
        <RequireRole permission="canManageSprints" mode="disable">
          <button>Start Sprint</button>
        </RequireRole>,
      )
      const button = screen.getByText('Start Sprint')
      expect(button).not.toBeDisabled()
    })
  })

  describe('fallback', () => {
    it('should render fallback when unauthorized in hide mode', () => {
      setupPermissions({ workspaceRole: 'Viewer' })
      render(
        <RequireRole role="Admin" fallback={<span>No access</span>}>
          <button>Delete</button>
        </RequireRole>,
      )
      expect(screen.queryByText('Delete')).not.toBeInTheDocument()
      expect(screen.getByText('No access')).toBeInTheDocument()
    })

    it('should not render fallback when authorized', () => {
      setupPermissions({ workspaceRole: 'Admin' })
      render(
        <RequireRole role="Admin" fallback={<span>No access</span>}>
          <button>Delete</button>
        </RequireRole>,
      )
      expect(screen.getByText('Delete')).toBeInTheDocument()
      expect(screen.queryByText('No access')).not.toBeInTheDocument()
    })
  })

  /* JL-198: on a fresh page load usePermissions reports loaded:false with every
     capability false until /api/auth/me returns. Deciding then bounced a system
     admin off /users and /members on every direct visit or refresh. */
  describe('before permissions load (JL-198)', () => {
    const NOT_LOADED = { loaded: false, workspaceRole: null, isOwner: false, isAdmin: false, canManageUsers: false }

    // The App.jsx composition: a route guarded with a redirect fallback.
    const renderGuardedRoute = () => render(
      <MemoryRouter initialEntries={['/users']}>
        <Routes>
          <Route path="/" element={<h1>Dashboard</h1>} />
          <Route
            path="/users"
            element={(
              <RequireRole permission="canManageUsers" fallback={<Navigate to="/" replace />}>
                <h1>User Management</h1>
              </RequireRole>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )

    it('does not redirect while permissions are loading', () => {
      usePermissions.mockReturnValue(NOT_LOADED)
      renderGuardedRoute()
      expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'User Management' })).not.toBeInTheDocument()
    })

    it("shows the page once a system admin's permissions arrive (refresh sequence)", () => {
      usePermissions.mockReturnValue(NOT_LOADED)
      const { rerender } = renderGuardedRoute()
      setupPermissions({ workspaceRole: 'Admin', isAdmin: true, canManageUsers: true })
      rerender(
        <MemoryRouter initialEntries={['/users']}>
          <Routes>
            <Route path="/" element={<h1>Dashboard</h1>} />
            <Route
              path="/users"
              element={(
                <RequireRole permission="canManageUsers" fallback={<Navigate to="/" replace />}>
                  <h1>User Management</h1>
                </RequireRole>
              )}
            />
          </Routes>
        </MemoryRouter>,
      )
      expect(screen.getByRole('heading', { name: 'User Management' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
    })

    it('still redirects a user without the permission once loaded', () => {
      setupPermissions({ workspaceRole: 'Member', canManageUsers: false })
      renderGuardedRoute()
      expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'User Management' })).not.toBeInTheDocument()
    })

    it('renders no inline fallback while loading', () => {
      usePermissions.mockReturnValue(NOT_LOADED)
      render(
        <RequireRole role="Admin" fallback={<span>No access</span>}>
          <button>Delete</button>
        </RequireRole>,
      )
      expect(screen.queryByText('No access')).not.toBeInTheDocument()
      expect(screen.queryByText('Delete')).not.toBeInTheDocument()
    })

    it("keeps 'disable' mode showing its children disabled while loading", () => {
      usePermissions.mockReturnValue(NOT_LOADED)
      render(
        <RequireRole permission="canManageUsers" mode="disable">
          <button>Invite</button>
        </RequireRole>,
      )
      expect(screen.getByText('Invite')).toBeDisabled()
    })

    it('renders an ungated wrapper (no role or permission) immediately', () => {
      usePermissions.mockReturnValue(NOT_LOADED)
      render(
        <RequireRole>
          <button>Open</button>
        </RequireRole>,
      )
      expect(screen.getByText('Open')).toBeInTheDocument()
    })
  })
})
