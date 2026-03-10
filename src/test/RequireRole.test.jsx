import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
