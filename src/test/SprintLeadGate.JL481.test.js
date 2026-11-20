/*
 * JL-481 — canManageSprints is the frontend mirror of the server's
 * requireProjectAdmin on the sprint routes: workspace Owner/Admin, or the
 * caller's role on THIS project is Lead or Admin. The server used to gate on
 * the workspace role only, so the Backlog offered "Create sprint" to a Lead
 * and the API refused it. These cases are the same ones
 * server/__tests__/sprint-lead-gate-JL481.test.js asserts on the API side.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePermissions } from '../hooks/usePermissions'

vi.mock('../context/MemberContext', () => ({ useMembers: vi.fn() }))
import { useMembers } from '../context/MemberContext'

function canManageSprints(currentMember, projectId) {
  useMembers.mockReturnValue({ currentMember })
  return renderHook(() => usePermissions(projectId)).result.current.canManageSprints
}

const wsMember = (projectRoles) => ({ workspaceRole: 'Member', isOwner: false, projectRoles })

describe('JL-481 canManageSprints mirrors the server sprint gate', () => {
  it('a workspace Member who is project Lead or Admin may manage that project\'s sprints', () => {
    expect(canManageSprints(wsMember([{ projectId: 4, role: 'Lead' }]), 4)).toBe(true)
    expect(canManageSprints(wsMember([{ projectId: 4, role: 'Admin' }]), 4)).toBe(true)
  })

  it.each(['Member', 'Viewer'])('a project %s may not', (role) => {
    expect(canManageSprints(wsMember([{ projectId: 4, role }]), 4)).toBe(false)
  })

  it('a Lead of project 4 may not manage project 5\'s sprints', () => {
    expect(canManageSprints(wsMember([{ projectId: 4, role: 'Lead' }]), 5)).toBe(false)
  })

  it('a workspace Admin may, with no project role', () => {
    expect(canManageSprints({ workspaceRole: 'Admin', isOwner: false, projectRoles: [] }, 5)).toBe(true)
  })
})
