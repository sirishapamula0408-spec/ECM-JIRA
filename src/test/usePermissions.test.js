import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePermissions } from '../hooks/usePermissions'

// Mock MemberContext
vi.mock('../context/MemberContext', () => ({
  useMembers: vi.fn(),
}))

import { useMembers } from '../context/MemberContext'

function setupMock(currentMember) {
  useMembers.mockReturnValue({ currentMember })
}

describe('usePermissions', () => {
  it('should return all false when currentMember is null (loading)', () => {
    setupMock(null)
    const { result } = renderHook(() => usePermissions())
    expect(result.current.loaded).toBe(false)
    expect(result.current.canCreateIssue).toBe(false)
    expect(result.current.canManageSprints).toBe(false)
    expect(result.current.canInviteMembers).toBe(false)
  })

  describe('Workspace Owner', () => {
    it('should have all permissions', () => {
      setupMock({
        workspaceRole: 'Admin',
        isOwner: true,
        projectRoles: [],
      })
      const { result } = renderHook(() => usePermissions())
      expect(result.current.loaded).toBe(true)
      expect(result.current.isOwner).toBe(true)
      expect(result.current.isAdmin).toBe(true)
      expect(result.current.canCreateIssue).toBe(true)
      expect(result.current.canDeleteIssue).toBe(true)
      expect(result.current.canManageSprints).toBe(true)
      expect(result.current.canManageMembers).toBe(true)
      expect(result.current.canInviteMembers).toBe(true)
      expect(result.current.canDeleteProject).toBe(true)
      expect(result.current.canCreateProject).toBe(true)
      expect(result.current.canEditWorkflows).toBe(true)
      expect(result.current.canAddComment).toBe(true)
    })
  })

  describe('Workspace Admin', () => {
    it('should have all permissions except isOwner', () => {
      setupMock({
        workspaceRole: 'Admin',
        isOwner: false,
        projectRoles: [],
      })
      const { result } = renderHook(() => usePermissions())
      expect(result.current.isOwner).toBe(false)
      expect(result.current.isAdmin).toBe(true)
      expect(result.current.canCreateIssue).toBe(true)
      expect(result.current.canDeleteIssue).toBe(true)
      expect(result.current.canManageSprints).toBe(true)
      expect(result.current.canInviteMembers).toBe(true)
      expect(result.current.canDeleteProject).toBe(true)
    })
  })

  describe('Workspace Member', () => {
    it('should have create/edit but not admin permissions', () => {
      setupMock({
        workspaceRole: 'Member',
        isOwner: false,
        projectRoles: [],
      })
      const { result } = renderHook(() => usePermissions())
      expect(result.current.isAdmin).toBe(false)
      expect(result.current.canCreateIssue).toBe(true)
      expect(result.current.canEditIssue).toBe(true)
      expect(result.current.canAddComment).toBe(true)
      expect(result.current.canCreateProject).toBe(true)
      expect(result.current.canDeleteIssue).toBe(false)
      expect(result.current.canManageSprints).toBe(false)
      expect(result.current.canInviteMembers).toBe(false)
      expect(result.current.canDeleteProject).toBe(false)
    })

    it('should gain project Admin permissions when project Admin', () => {
      setupMock({
        workspaceRole: 'Member',
        isOwner: false,
        projectRoles: [{ projectId: 1, projectKey: 'TP', role: 'Admin' }],
      })
      const { result } = renderHook(() => usePermissions(1))
      expect(result.current.projectRole).toBe('Admin')
      expect(result.current.canDeleteIssue).toBe(true)
      expect(result.current.canManageSprints).toBe(true)
      expect(result.current.canManageProjectSettings).toBe(true)
      // But still not workspace admin perms
      expect(result.current.canInviteMembers).toBe(false)
      expect(result.current.canDeleteProject).toBe(false)
    })
  })

  describe('Workspace Viewer', () => {
    it('should have read-only permissions', () => {
      setupMock({
        workspaceRole: 'Viewer',
        isOwner: false,
        projectRoles: [],
      })
      const { result } = renderHook(() => usePermissions())
      expect(result.current.canCreateIssue).toBe(false)
      expect(result.current.canEditIssue).toBe(false)
      expect(result.current.canDeleteIssue).toBe(false)
      expect(result.current.canManageSprints).toBe(false)
      expect(result.current.canInviteMembers).toBe(false)
      expect(result.current.canCreateProject).toBe(false)
      expect(result.current.canAddComment).toBe(false)
    })

    it('should not gain permissions even with project Viewer role', () => {
      setupMock({
        workspaceRole: 'Viewer',
        isOwner: false,
        projectRoles: [{ projectId: 1, projectKey: 'TP', role: 'Viewer' }],
      })
      const { result } = renderHook(() => usePermissions(1))
      expect(result.current.projectRole).toBe('Viewer')
      expect(result.current.canCreateIssue).toBe(false)
      expect(result.current.canEditIssue).toBe(false)
    })
  })

  describe('Project context', () => {
    it('should return null projectRole when no projectId given', () => {
      setupMock({
        workspaceRole: 'Member',
        isOwner: false,
        projectRoles: [{ projectId: 1, projectKey: 'TP', role: 'Admin' }],
      })
      const { result } = renderHook(() => usePermissions())
      expect(result.current.projectRole).toBeNull()
    })

    it('should return null projectRole when user is not in project', () => {
      setupMock({
        workspaceRole: 'Member',
        isOwner: false,
        projectRoles: [{ projectId: 1, projectKey: 'TP', role: 'Admin' }],
      })
      const { result } = renderHook(() => usePermissions(999))
      expect(result.current.projectRole).toBeNull()
      expect(result.current.canDeleteIssue).toBe(false)
    })

    it('should match projectId as string', () => {
      setupMock({
        workspaceRole: 'Member',
        isOwner: false,
        projectRoles: [{ projectId: 1, projectKey: 'TP', role: 'Admin' }],
      })
      const { result } = renderHook(() => usePermissions('1'))
      expect(result.current.projectRole).toBe('Admin')
    })
  })
})
