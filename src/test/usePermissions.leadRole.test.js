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

describe('usePermissions — project Lead role (JL-210)', () => {
  it('treats a project Lead as full project admin', () => {
    setupMock({
      workspaceRole: 'Member',
      isOwner: false,
      projectRoles: [{ projectId: 1, projectKey: 'TP', role: 'Lead' }],
    })
    const { result } = renderHook(() => usePermissions(1))

    expect(result.current.projectRole).toBe('Lead')
    // Lead is the top project tier → full project-admin capabilities
    expect(result.current.canManageProjectSettings).toBe(true)
    expect(result.current.canManageSprints).toBe(true)
    expect(result.current.canDeleteIssue).toBe(true)
    expect(result.current.canCreateIssue).toBe(true)
    expect(result.current.canEditIssue).toBe(true)

    // …but a project Lead is NOT a workspace admin
    expect(result.current.isAdmin).toBe(false)
    expect(result.current.canInviteMembers).toBe(false)
    expect(result.current.canDeleteProject).toBe(false)
  })

  it('does not grant project-admin caps without the Lead/Admin project role', () => {
    setupMock({
      workspaceRole: 'Member',
      isOwner: false,
      projectRoles: [{ projectId: 1, projectKey: 'TP', role: 'Member' }],
    })
    const { result } = renderHook(() => usePermissions(1))
    expect(result.current.projectRole).toBe('Member')
    expect(result.current.canManageProjectSettings).toBe(false)
    expect(result.current.canManageSprints).toBe(false)
    // JL-228: delete is no longer project-admin-gated — Members can delete
    expect(result.current.canDeleteIssue).toBe(true)
  })
})
