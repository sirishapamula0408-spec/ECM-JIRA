// @vitest-environment node
// JL-289 — an explicit project role is AUTHORITATIVE within its project.
//
// Before JL-289 `resolveProjectAccess` computed effectiveRank as
// Math.max(workspaceRank, projectRank), which made project roles elevation-only:
// assigning someone the project "Viewer" role never restricted them if their
// workspace role was Member or higher, so "project Viewer = read-only" was only
// ever true for workspace Viewers.
//
// New rule (mirrored verbatim in src/hooks/usePermissions.js):
//   effectiveRank = projectRole ? projectRank : workspaceRank
// Workspace Owner/Admin are resolved before any project lookup and keep their
// full bypass. Read access (hasAccess) is membership-based and unchanged — only
// write capability narrows.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { get } from '../db.js'
import {
  ROLE_RANK,
  resolveProjectAccess,
  requireProjectRole,
  requireProjectRead,
  requireProjectWrite,
} from '../middleware/authorize.js'

const PROJECT_ID = 5

/* ------------------------------------------------------------------
   The JL-289 semantics matrix. This exact table is mirrored in
   src/test/usePermissions.JL289.test.jsx so backend/frontend drift is
   caught by whichever side changes first.
   ------------------------------------------------------------------ */
const MATRIX = [
  // workspace role | project role | effective rank | write? | project-admin?
  { name: 'Member + project Viewer → RESTRICTED to Viewer (the JL-289 fix)', workspaceRole: 'Member', isOwner: false, projectRole: 'Viewer', expectedRank: 1 },
  { name: 'Member + project Admin → Admin', workspaceRole: 'Member', isOwner: false, projectRole: 'Admin', expectedRank: 3 },
  { name: 'Viewer + project Admin → Admin (elevation still works)', workspaceRole: 'Viewer', isOwner: false, projectRole: 'Admin', expectedRank: 3 },
  { name: 'Viewer + project Viewer → Viewer', workspaceRole: 'Viewer', isOwner: false, projectRole: 'Viewer', expectedRank: 1 },
  { name: 'Member + no project role → Member (unchanged fallback)', workspaceRole: 'Member', isOwner: false, projectRole: null, expectedRank: 2 },
  { name: 'workspace Admin + project Viewer → Admin bypass (unchanged)', workspaceRole: 'Admin', isOwner: false, projectRole: 'Viewer', expectedRank: 3, adminBypass: true },
  { name: 'workspace Owner + project Viewer → Owner bypass (unchanged)', workspaceRole: 'Member', isOwner: true, projectRole: 'Viewer', expectedRank: 3, adminBypass: true },
  { name: 'Member + project Lead → Lead', workspaceRole: 'Member', isOwner: false, projectRole: 'Lead', expectedRank: 4 },
]

// Capability derived purely from the effective rank. This is the formula the
// frontend hook applies (src/test/usePermissions.JL289.test.jsx asserts the same
// column), and it is the rank half of the backend write gate.
const rankAllowsWrite = (row) => row.expectedRank >= ROLE_RANK.Member
const rankAllowsProjectAdmin = (row) => row.expectedRank >= ROLE_RANK.Admin

// The backend write gate is rank AND project membership (JL-226): a workspace
// Member with no project role has rank Member but no access to this project.
const gateAllowsWrite = (row) =>
  Boolean(row.adminBypass) || (Boolean(row.projectRole) && rankAllowsWrite(row))
const gateAllowsProjectAdmin = (row) =>
  Boolean(row.adminBypass) || (Boolean(row.projectRole) && rankAllowsProjectAdmin(row))

const userFor = (row) => ({
  id: 30,
  email: 'u@test.com',
  memberId: 30,
  workspaceRole: row.workspaceRole,
  isOwner: row.isOwner,
})

// Access-join row shape produced by resolveProjectAccess's query.
const accessRow = (projectRole) => ({
  id: PROJECT_ID,
  lead_member_id: 999,
  project_role: projectRole,
})

function mockAccess(projectRole) {
  get.mockImplementation(async (sql) => {
    if (sql.includes('pm.role AS project_role')) return accessRow(projectRole)
    return null
  })
}

/** Runs one middleware and reports whether it called next() or answered 4xx. */
function runMw(mw, user) {
  return new Promise((resolve, reject) => {
    const req = { user, params: { id: String(PROJECT_ID) }, body: {} }
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code
        return this
      },
      json(body) {
        resolve({ passed: false, status: this.statusCode, body })
      },
    }
    Promise.resolve(mw(req, res, (err) => (err ? reject(err) : resolve({ passed: true, status: 200 })))).catch(reject)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ============================================================
   resolveProjectAccess — the whole matrix
   ============================================================ */
describe('JL-289 — resolveProjectAccess effectiveRank matrix', () => {
  for (const row of MATRIX) {
    it(row.name, async () => {
      mockAccess(row.projectRole)
      const access = await resolveProjectAccess(userFor(row), PROJECT_ID)

      expect(access.effectiveRank).toBe(row.expectedRank)
      expect(access.admin).toBe(Boolean(row.adminBypass))
      // Everyone in this matrix can READ the project: admins bypass, and every
      // non-admin row either holds a project role or (Member + no role) is
      // covered by the separate no-membership case below.
      if (row.adminBypass) {
        expect(access.hasAccess).toBe(true)
        // Bypass happens before any project lookup — no db round-trip.
        expect(get).not.toHaveBeenCalled()
      } else {
        expect(access.projectRole).toBe(row.projectRole)
        expect(access.hasAccess).toBe(Boolean(row.projectRole))
      }
    })
  }

  it('a workspace Member with no project role keeps their workspace rank but no access', async () => {
    mockAccess(null)
    const access = await resolveProjectAccess(
      { memberId: 30, workspaceRole: 'Member', isOwner: false },
      PROJECT_ID,
    )
    expect(access.effectiveRank).toBe(ROLE_RANK.Member)
    expect(access.hasAccess).toBe(false)
  })

  it('the project lead is resolved as Lead when there is no project_members row', async () => {
    get.mockResolvedValueOnce({ id: PROJECT_ID, lead_member_id: 30, project_role: null })
    const access = await resolveProjectAccess(
      { memberId: 30, workspaceRole: 'Member', isOwner: false },
      PROJECT_ID,
    )
    expect(access.projectRole).toBe('Lead')
    expect(access.effectiveRank).toBe(ROLE_RANK.Lead)
  })

  it('a missing project falls back to the workspace rank (unchanged)', async () => {
    get.mockResolvedValueOnce(undefined)
    const access = await resolveProjectAccess(
      { memberId: 30, workspaceRole: 'Member', isOwner: false },
      999,
    )
    expect(access.projectExists).toBe(false)
    expect(access.effectiveRank).toBe(ROLE_RANK.Member)
  })
})

/* ============================================================
   READ is NOT narrowed — a project Viewer still reads the project
   ============================================================ */
describe('JL-289 — read access is unaffected', () => {
  it('a workspace Member holding project Viewer can still READ the project', async () => {
    mockAccess('Viewer')
    const access = await resolveProjectAccess(
      { memberId: 30, workspaceRole: 'Member', isOwner: false },
      PROJECT_ID,
    )
    expect(access.hasAccess).toBe(true)
    expect(access.effectiveRank).toBe(ROLE_RANK.Viewer)
  })

  it('requireProjectRead lets a workspace-Member/project-Viewer through', async () => {
    mockAccess('Viewer')
    const result = await runMw(
      requireProjectRead(() => PROJECT_ID),
      { memberId: 30, workspaceRole: 'Member', isOwner: false },
    )
    expect(result.passed).toBe(true)
  })

  it('requireProjectRead still blocks a workspace Member with no project role', async () => {
    mockAccess(null)
    const result = await runMw(
      requireProjectRead(() => PROJECT_ID),
      { memberId: 30, workspaceRole: 'Member', isOwner: false },
    )
    expect(result.passed).toBe(false)
    expect(result.status).toBe(403)
  })
})

/* ============================================================
   WRITE gating across the matrix
   ============================================================ */
describe('JL-289 — requireProjectWrite across the matrix', () => {
  for (const row of MATRIX) {
    it(`${gateAllowsWrite(row) ? 'allows' : 'denies'} write: ${row.name}`, async () => {
      mockAccess(row.projectRole)
      const result = await runMw(requireProjectWrite(() => PROJECT_ID), userFor(row))
      expect(result.passed).toBe(gateAllowsWrite(row))
      if (!gateAllowsWrite(row)) expect(result.status).toBe(403)
    })
  }

  it('403 — workspace Member holding project Viewer is denied a project write', async () => {
    mockAccess('Viewer')
    const result = await runMw(
      requireProjectWrite(() => PROJECT_ID),
      { memberId: 30, workspaceRole: 'Member', isOwner: false },
    )
    expect(result.passed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toEqual({ error: 'Insufficient project permissions' })
  })

  it('project-less targets still fall back to the workspace-role gate', async () => {
    // resolveId yields null → projectExists false → legacy workspace gate.
    const memberResult = await runMw(
      requireProjectWrite(() => null),
      { memberId: 30, workspaceRole: 'Member', isOwner: false },
    )
    expect(memberResult.passed).toBe(true)

    const viewerResult = await runMw(
      requireProjectWrite(() => null),
      { memberId: 40, workspaceRole: 'Viewer', isOwner: false },
    )
    expect(viewerResult.passed).toBe(false)
    expect(viewerResult.status).toBe(403)
  })
})

/* ============================================================
   requireProjectRole — the role-name gate agrees with the matrix
   ============================================================ */
describe('JL-289 — requireProjectRole agrees with the matrix', () => {
  for (const row of MATRIX) {
    it(`requireProjectRole('Member') ${gateAllowsWrite(row) ? 'allows' : 'denies'}: ${row.name}`, async () => {
      // loadProjectRole has already put the project role on req.user.
      const user = { ...userFor(row), projectRole: row.projectRole }
      const result = await runMw(requireProjectRole('Member'), user)
      expect(result.passed).toBe(gateAllowsWrite(row))
    })

    it(`requireProjectRole('Admin') ${gateAllowsProjectAdmin(row) ? 'allows' : 'denies'}: ${row.name}`, async () => {
      const user = { ...userFor(row), projectRole: row.projectRole }
      const result = await runMw(requireProjectRole('Admin'), user)
      expect(result.passed).toBe(gateAllowsProjectAdmin(row))
    })
  }

  it("requireProjectRole('Member') rejects a workspace Member holding project Viewer", async () => {
    const result = await runMw(requireProjectRole('Member'), {
      memberId: 30,
      workspaceRole: 'Member',
      isOwner: false,
      projectRole: 'Viewer',
    })
    expect(result.passed).toBe(false)
    expect(result.status).toBe(403)
  })
})
