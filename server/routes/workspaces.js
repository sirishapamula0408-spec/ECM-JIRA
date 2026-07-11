import { Router } from 'express'
import { all, get, run, withTransaction } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { DEFAULT_WORKSPACE_SLUG } from '../middleware/workspace.js'

/*
 * JL-73 — Multi-workspace / tenant data isolation (FOUNDATION / MVP).
 *
 * This router delivers the ADDITIVE, BACKWARD-COMPATIBLE workspace foundation:
 *   - schema: workspaces + workspace_members, nullable workspace_id on
 *     projects/members (see server/db.js), with existing data backfilled to a
 *     single seeded 'default' workspace.
 *   - request context: resolveWorkspace / pickWorkspaceId (middleware/workspace.js).
 *   - management endpoints: list / create / get / add-member / current (below).
 *
 * FOLLOW-ON (explicitly OUT OF SCOPE here): full per-query row isolation — i.e.
 * scoping every issue/sprint/project/member query by req.workspaceId and
 * enforcing cross-tenant read/write boundaries on every endpoint. This ticket
 * lays the schema, context, and management surface only; nothing here changes
 * the row-visibility of existing routes.
 */

const PRIVILEGED_WORKSPACE_ROLES = ['Owner', 'Admin']

/** Slugify a workspace name into a URL-safe unique-ish slug. */
function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace'
  )
}

const router = Router()

// GET /api/workspaces — list the workspaces the caller belongs to.
router.get('/', asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT w.id, w.name, w.slug, w.owner_email, w.created_at, wm.role
     FROM workspaces w
     JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE LOWER(wm.member_email) = LOWER(?)
     ORDER BY w.created_at ASC, w.id ASC`,
    [req.user.email],
  )
  res.json(rows)
}))

// GET /api/workspaces/current — resolve the caller's current workspace.
// Uses req.workspaceId when the resolveWorkspace middleware ran; otherwise
// falls back to the seeded default workspace.
router.get('/current', asyncHandler(async (req, res) => {
  let workspace = null
  if (req.workspaceId) {
    workspace = await get(
      'SELECT id, name, slug, owner_email, created_at FROM workspaces WHERE id = ?',
      [req.workspaceId],
    )
  }
  if (!workspace) {
    workspace = await get(
      'SELECT id, name, slug, owner_email, created_at FROM workspaces WHERE slug = ?',
      [DEFAULT_WORKSPACE_SLUG],
    )
  }
  res.json(workspace || null)
}))

// POST /api/workspaces — create a workspace and make the caller its Owner.
router.post('/', asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) {
    res.status(400).json({ error: 'Workspace name is required' })
    return
  }

  let slug = slugify(name)
  const existing = await get('SELECT id FROM workspaces WHERE slug = ?', [slug])
  if (existing) {
    slug = `${slug}-${Date.now().toString(36)}`
  }

  // JL-94: the workspace row and its owner membership must be created atomically.
  const workspace = await withTransaction(async (tx) => {
    const created = await tx.run(
      'INSERT INTO workspaces (name, slug, owner_email) VALUES (?, ?, ?)',
      [name, slug, req.user.email],
    )
    // Owner membership (idempotent).
    await tx.run(
      `INSERT INTO workspace_members (workspace_id, member_email, role)
       VALUES (?, ?, 'Owner')
       ON CONFLICT (workspace_id, member_email) DO NOTHING`,
      [created.lastID, req.user.email],
    )

    return tx.get(
      'SELECT id, name, slug, owner_email, created_at FROM workspaces WHERE id = ?',
      [created.lastID],
    )
  })
  res.status(201).json(workspace)
}))

// GET /api/workspaces/:id — fetch a single workspace the caller can access.
router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid workspace id' })
    return
  }

  const membership = await get(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND LOWER(member_email) = LOWER(?)',
    [id, req.user.email],
  )
  // Workspace-scoped access: members, or a global Owner/Admin, may read.
  const globallyPrivileged = req.user.isOwner || req.user.workspaceRole === 'Admin'
  if (!membership && !globallyPrivileged) {
    res.status(403).json({ error: 'You do not have access to this workspace' })
    return
  }

  const workspace = await get(
    'SELECT id, name, slug, owner_email, created_at FROM workspaces WHERE id = ?',
    [id],
  )
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' })
    return
  }
  res.json({ ...workspace, role: membership?.role || null })
}))

// POST /api/workspaces/:id/members — add (or re-role) a member. Owner/Admin only.
router.post('/:id/members', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid workspace id' })
    return
  }

  const email = String(req.body?.email || '').trim().toLowerCase()
  const role = String(req.body?.role || 'Member').trim() || 'Member'
  if (!email) {
    res.status(400).json({ error: 'Member email is required' })
    return
  }

  // Global Owner/Admin bypass; otherwise the caller must be Owner/Admin of THIS workspace.
  let privileged = req.user.isOwner || req.user.workspaceRole === 'Admin'
  if (!privileged) {
    const caller = await get(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND LOWER(member_email) = LOWER(?)',
      [id, req.user.email],
    )
    privileged = PRIVILEGED_WORKSPACE_ROLES.includes(caller?.role)
  }
  if (!privileged) {
    res.status(403).json({ error: 'Insufficient permissions to manage workspace members' })
    return
  }

  const created = await run(
    `INSERT INTO workspace_members (workspace_id, member_email, role)
     VALUES (?, ?, ?)
     ON CONFLICT (workspace_id, member_email) DO UPDATE SET role = EXCLUDED.role
     RETURNING id`,
    [id, email, role],
  )
  const member = await get(
    'SELECT id, workspace_id, member_email, role, created_at FROM workspace_members WHERE id = ?',
    [created.lastID],
  )
  res.status(201).json(member)
}))

export default router
