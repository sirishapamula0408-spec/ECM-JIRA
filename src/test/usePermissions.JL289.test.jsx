// JL-289 — an explicit project role is AUTHORITATIVE within its project.
//
// usePermissions used to compute effectiveRank as Math.max(wsRank, projRank),
// which made project roles elevation-only: a workspace Member assigned the
// project "Viewer" role kept full write capability, so "project Viewer =
// read-only" was only ever true for workspace Viewers.
//
// New rule (mirrored verbatim in server/middleware/authorize.js's
// resolveProjectAccess):
//   effectiveRank = projectRole ? projRank : wsRank
// Workspace Owner/Admin keep their unconditional Admin rank.
//
// The MATRIX below is the same table asserted in
// server/__tests__/project-role-authoritative-JL289.test.js — if the two sides
// of the stack ever drift, one of the two suites fails.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePermissions } from '../hooks/usePermissions'

vi.mock('../context/MemberContext', () => ({ useMembers: vi.fn() }))

import { useMembers } from '../context/MemberContext'

const ROLE_RANK = { Viewer: 1, Member: 2, Admin: 3, Lead: 4 }
const PROJECT_ID = 5

/* ------------------------------------------------------------------
   The JL-289 semantics matrix — mirrored from the backend suite.
   ------------------------------------------------------------------ */
const MATRIX = [
  { name: 'Member + project Viewer → RESTRICTED to Viewer (the JL-289 fix)', workspaceRole: 'Member', isOwner: false, projectRole: 'Viewer', expectedRank: 1 },
  { name: 'Member + project Admin → Admin', workspaceRole: 'Member', isOwner: false, projectRole: 'Admin', expectedRank: 3 },
  { name: 'Viewer + project Admin → Admin (elevation still works)', workspaceRole: 'Viewer', isOwner: false, projectRole: 'Admin', expectedRank: 3 },
  { name: 'Viewer + project Viewer → Viewer', workspaceRole: 'Viewer', isOwner: false, projectRole: 'Viewer', expectedRank: 1 },
  { name: 'Member + no project role → Member (unchanged fallback)', workspaceRole: 'Member', isOwner: false, projectRole: null, expectedRank: 2 },
  { name: 'workspace Admin + project Viewer → Admin bypass (unchanged)', workspaceRole: 'Admin', isOwner: false, projectRole: 'Viewer', expectedRank: 3, adminBypass: true },
  { name: 'workspace Owner + project Viewer → Owner bypass (unchanged)', workspaceRole: 'Member', isOwner: true, projectRole: 'Viewer', expectedRank: 3, adminBypass: true },
  { name: 'Member + project Lead → Lead', workspaceRole: 'Member', isOwner: false, projectRole: 'Lead', expectedRank: 4 },
]

// Same rank-derived formulas the backend suite uses.
const rankAllowsWrite = (row) => row.expectedRank >= ROLE_RANK.Member
const rankAllowsProjectAdmin = (row) => row.expectedRank >= ROLE_RANK.Admin

function setMember(row) {
  useMembers.mockReturnValue({
    currentMember: {
      workspaceRole: row.workspaceRole,
      isOwner: row.isOwner,
      projectRoles: row.projectRole
        ? [{ projectId: PROJECT_ID, projectKey: 'TP', role: row.projectRole }]
        : [],
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('JL-289 — usePermissions effective-rank matrix', () => {
  for (const row of MATRIX) {
    it(row.name, () => {
      setMember(row)
      const { result } = renderHook(() => usePermissions(PROJECT_ID))
      const p = result.current

      expect(p.loaded).toBe(true)
      expect(p.projectRole).toBe(row.projectRole)

      // Write-tier capabilities (effectiveRank >= Member)
      expect(p.canCreateIssue).toBe(rankAllowsWrite(row))
      expect(p.canEditIssue).toBe(rankAllowsWrite(row))
      expect(p.canDeleteIssue).toBe(rankAllowsWrite(row))
      expect(p.canAddComment).toBe(rankAllowsWrite(row))
      expect(p.canLogWork).toBe(rankAllowsWrite(row))
      expect(p.canAddAttachment).toBe(rankAllowsWrite(row))
      expect(p.canLinkIssues).toBe(rankAllowsWrite(row))

      // Project-admin-tier capabilities (effectiveRank >= Admin)
      expect(p.canManageSprints).toBe(rankAllowsProjectAdmin(row))
      expect(p.canManageProjectSettings).toBe(rankAllowsProjectAdmin(row))

      // Workspace-admin bypass is untouched by JL-289
      expect(p.isAdmin).toBe(Boolean(row.adminBypass))
    })
  }
})

describe('JL-289 — the specific bug being fixed', () => {
  it('a workspace Member holding project Viewer is now genuinely read-only in that project', () => {
    setMember({ workspaceRole: 'Member', isOwner: false, projectRole: 'Viewer' })
    const { result } = renderHook(() => usePermissions(PROJECT_ID))

    expect(result.current.projectRole).toBe('Viewer')
    expect(result.current.canEditIssue).toBe(false)
    expect(result.current.canCreateIssue).toBe(false)
    expect(result.current.canDeleteIssue).toBe(false)
    expect(result.current.canAddComment).toBe(false)
    expect(result.current.canManageSprints).toBe(false)

    // …but READ-tier capability is unaffected — exporting is a read (JL-288).
    expect(result.current.canExportIssues).toBe(true)
  })

  it('the same user is unrestricted on a project where they hold no role', () => {
    useMembers.mockReturnValue({
      currentMember: {
        workspaceRole: 'Member',
        isOwner: false,
        projectRoles: [{ projectId: PROJECT_ID, projectKey: 'TP', role: 'Viewer' }],
      },
    })
    // Project 99 — no explicit role, so the workspace rank applies.
    const { result } = renderHook(() => usePermissions(99))
    expect(result.current.projectRole).toBeNull()
    expect(result.current.canEditIssue).toBe(true)
  })

  it('with no projectId at all, the workspace rank applies (project-agnostic UI)', () => {
    useMembers.mockReturnValue({
      currentMember: {
        workspaceRole: 'Member',
        isOwner: false,
        projectRoles: [{ projectId: PROJECT_ID, projectKey: 'TP', role: 'Viewer' }],
      },
    })
    const { result } = renderHook(() => usePermissions())
    expect(result.current.projectRole).toBeNull()
    expect(result.current.canEditIssue).toBe(true)
  })

  it('workspace-level capabilities are never narrowed by a project role', () => {
    setMember({ workspaceRole: 'Member', isOwner: false, projectRole: 'Viewer' })
    const { result } = renderHook(() => usePermissions(PROJECT_ID))
    // canCreateProject and canManageCrossProjectBoards are workspace-scoped.
    expect(result.current.canCreateProject).toBe(true)
    expect(result.current.canManageCrossProjectBoards).toBe(true)
  })
})
