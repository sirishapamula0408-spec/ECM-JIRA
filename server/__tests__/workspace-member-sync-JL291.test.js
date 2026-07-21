// @vitest-environment node
// JL-291: workspace Owner/members were locked out when the frontend sent
// X-Workspace-Id, because isWorkspaceMember() only consulted workspace_members,
// which drifts out of sync with the authoritative `members` directory. The fix
// makes membership resolvable from EITHER table (or is_owner).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { get } from '../db.js'
import { resolveWorkspace, isWorkspaceMember } from '../middleware/workspace.js'
import { errorHandler } from '../middleware/errorHandler.js'

beforeEach(() => vi.clearAllMocks())

describe('JL-291: isWorkspaceMember also honors the members directory', () => {
  it('queries workspace_members AND the members table (workspace_id / is_owner)', async () => {
    get.mockResolvedValueOnce({ ok: 1 })
    const result = await isWorkspaceMember('owner@test.com', 1)
    expect(result).toBe(true)
    const sql = get.mock.calls[0][0]
    expect(sql).toMatch(/workspace_members/i)
    expect(sql).toMatch(/FROM members/i)
    expect(sql).toMatch(/is_owner/i)
    // params: [workspaceId, email, email, workspaceId]
    expect(get.mock.calls[0][1]).toEqual([1, 'owner@test.com', 'owner@test.com', 1])
  })

  it('returns true for a member found only via the members table (workspace_members empty)', async () => {
    // The single UNION query resolves a row from the members branch.
    get.mockResolvedValueOnce({ ok: 1 })
    expect(await isWorkspaceMember('sirisha@sedintechnologies.com', 1)).toBe(true)
  })

  it('returns false for a genuine non-member (no row from either table)', async () => {
    get.mockResolvedValueOnce(null)
    expect(await isWorkspaceMember('stranger@test.com', 1)).toBe(false)
  })

  it('returns false for missing args without querying', async () => {
    expect(await isWorkspaceMember('', 1)).toBe(false)
    expect(await isWorkspaceMember('x@test.com', null)).toBe(false)
    expect(get).not.toHaveBeenCalled()
  })
})

describe('JL-291: resolveWorkspace accepts a members-only user with X-Workspace-Id', () => {
  function app(user = { id: 6, email: 'sirisha@sedintechnologies.com' }) {
    const a = express()
    a.use(express.json())
    a.use((req, _res, next) => { req.user = user; next() })
    a.use(resolveWorkspace)
    a.get('/probe', (req, res) => res.json({ workspaceId: req.workspaceId ?? null }))
    a.use(errorHandler)
    return a
  }

  it('does not 403 when the user is a member via the members table', async () => {
    // isWorkspaceMember's single query resolves a row (members branch) → accepted.
    get.mockResolvedValueOnce({ ok: 1 })
    const res = await request(app()).get('/probe').set('X-Workspace-Id', '1')
    expect(res.status).toBe(200)
    expect(res.body.workspaceId).toBe(1)
  })
})
