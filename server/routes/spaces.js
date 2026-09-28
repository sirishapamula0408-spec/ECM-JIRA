import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { maxLengthError } from '../utils/validation.js'

/*
 * Confluence Lite — Spaces.  JL-79 (module + routing) / JL-65 (management).
 *
 * A Space is the unit documentation is organised by, and it is deliberately
 * NOT a project. Documentation outlives and crosses projects — a runbook, an
 * onboarding guide, an architecture decision log — so `wiki_pages.space_id` is
 * nullable alongside the existing `project_id`. A page may belong to a project,
 * a Space, or both, and no existing page had to be migrated to keep working.
 *
 * ── The authorisation model (JL-87 / JL-139) ────────────────────────────────
 *
 * Space membership is a SECOND axis alongside workspace and project RBAC, and
 * the resolution order is defined here, once, rather than at each call site —
 * that scattering is exactly how JL-457 ended up with four places each deciding
 * a status colour differently.
 *
 *   1. A workspace Admin or Owner may do anything. This mirrors the project
 *      rule in middleware/authorize.js, where workspace Admin bypasses
 *      project-level checks, and keeps one mental model across the product.
 *   2. Otherwise the caller's space_members role decides, ranked
 *      Admin > Member > Viewer.
 *   3. A caller with no row is a Viewer of a public Space and has no access to
 *      a restricted one.
 *
 * Space roles reuse the project vocabulary on purpose. One set of words in the
 * product is worth more than a vocabulary tuned per feature.
 */

const router = Router()

export const SPACE_ROLES = ['Admin', 'Member', 'Viewer']
const SPACE_ROLE_RANK = { Viewer: 1, Member: 2, Admin: 3 }

const SPACE_NAME_MAX = 120
const SPACE_DESC_MAX = 2000

/** Columns every response returns. Never `SELECT *` — see the repo convention. */
const SPACE_COLUMNS =
  'id, key, name, description, owner_email, archived, created_by, created_at, updated_at'

/*
 * A Space key is the short prefix people type and say out loud: ENG, RUNBOOK,
 * HR. Same shape as a project key, and uppercased on write so "eng" and "ENG"
 * cannot become two Spaces — the unique index is on LOWER(key), so the database
 * enforces it even if a future caller forgets.
 */
const SPACE_KEY_RE = /^[A-Za-z][A-Za-z0-9]{1,9}$/

export function normalizeSpaceKey(raw) {
  const value = String(raw ?? '').trim()
  return SPACE_KEY_RE.test(value) ? value.toUpperCase() : null
}

/** True when this user is a workspace Admin or Owner. */
function isWorkspaceAdmin(user) {
  const role = String(user?.workspaceRole || '')
  return role === 'Admin' || role === 'Owner' || user?.isOwner === true
}

/**
 * Resolve a caller's effective role in a Space.
 *
 * Returns 'Admin' | 'Member' | 'Viewer' | null. null means no access at all,
 * which callers must treat as 404 rather than 403 — telling someone a Space
 * exists but is closed to them is itself a disclosure.
 */
export async function resolveSpaceRole(space, user) {
  if (!space) return null
  if (isWorkspaceAdmin(user)) return 'Admin'
  const email = String(user?.email || '').trim()
  if (!email) return null
  if (String(space.owner_email || '').toLowerCase() === email.toLowerCase()) return 'Admin'
  const row = await get(
    'SELECT role FROM space_members WHERE space_id = ? AND LOWER(user_email) = LOWER(?)',
    [space.id, email],
  )
  return row?.role && SPACE_ROLES.includes(row.role) ? row.role : 'Viewer'
}

/** Does `role` meet `minimum` on the Admin > Member > Viewer ranking? */
export function spaceRoleAtLeast(role, minimum) {
  return (SPACE_ROLE_RANK[role] || 0) >= (SPACE_ROLE_RANK[minimum] || 0)
}

async function loadSpace(idOrKey) {
  const value = String(idOrKey ?? '').trim()
  if (/^\d+$/.test(value)) {
    return get(`SELECT ${SPACE_COLUMNS} FROM spaces WHERE id = ?`, [Number(value)])
  }
  // Addressed by key, the same way JL-148 lets an issue be addressed by key.
  return get(`SELECT ${SPACE_COLUMNS} FROM spaces WHERE LOWER(key) = LOWER(?)`, [value])
}

/* ---------------------------------------------------------------- *
 * JL-85 — list the Spaces this caller can see
 * ---------------------------------------------------------------- */
router.get('/', asyncHandler(async (req, res) => {
  const includeArchived = String(req.query.archived || '') === 'true'
  const rows = await all(
    `SELECT ${SPACE_COLUMNS} FROM spaces ${includeArchived ? '' : 'WHERE archived = FALSE'} ORDER BY name ASC`,
  )

  // Decorate with the caller's own role so the client can gate its UI without
  // a request per Space, and drop the ones they cannot see at all.
  const visible = []
  for (const space of rows) {
    const role = await resolveSpaceRole(space, req.user)
    if (!role) continue
    const counts = await get(
      'SELECT COUNT(*)::int AS pages FROM wiki_pages WHERE space_id = ? AND deleted_at IS NULL',
      [space.id],
    )
    visible.push({ ...space, myRole: role, pageCount: Number(counts?.pages || 0) })
  }
  res.json(visible)
}))

/* ---------------------------------------------------------------- *
 * One Space, by id or key
 * ---------------------------------------------------------------- */
router.get('/:idOrKey', asyncHandler(async (req, res) => {
  const space = await loadSpace(req.params.idOrKey)
  const role = await resolveSpaceRole(space, req.user)
  if (!space || !role) {
    res.status(404).json({ error: 'Space not found' })
    return
  }
  const members = await all(
    'SELECT id, user_email, role, created_at FROM space_members WHERE space_id = ? ORDER BY user_email ASC',
    [space.id],
  )
  res.json({ ...space, myRole: role, members })
}))

/* ---------------------------------------------------------------- *
 * JL-82 — create a Space
 * ---------------------------------------------------------------- */
router.post('/', requireRole('Member'), asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const key = normalizeSpaceKey(req.body?.key)
  const description = String(req.body?.description || '').trim()

  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (!key) {
    res.status(400).json({ error: 'key must be 2-10 characters, starting with a letter' })
    return
  }
  const lengthErr = maxLengthError('name', name, SPACE_NAME_MAX)
    || maxLengthError('description', description, SPACE_DESC_MAX)
  if (lengthErr) {
    res.status(400).json({ error: lengthErr })
    return
  }

  const clash = await get('SELECT id FROM spaces WHERE LOWER(key) = LOWER(?)', [key])
  if (clash) {
    res.status(409).json({ error: `A Space with the key ${key} already exists` })
    return
  }

  const actor = req.user?.email || 'unknown'
  const created = await run(
    'INSERT INTO spaces (key, name, description, owner_email, created_by) VALUES (?, ?, ?, ?, ?)',
    [key, name, description, actor, actor],
  )
  // The creator is seeded as an explicit Admin member as well as the owner.
  // Owner is a single column and can be reassigned (JL-83); membership is what
  // the access check actually reads, so it must not depend on ownership alone.
  await run(
    'INSERT INTO space_members (space_id, user_email, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING id',
    [created.lastID, actor, 'Admin'],
  )

  const row = await get(`SELECT ${SPACE_COLUMNS} FROM spaces WHERE id = ?`, [created.lastID])
  res.status(201).json({ ...row, myRole: 'Admin', members: [] })
}))

/* ---------------------------------------------------------------- *
 * JL-83 — edit metadata, reassign the owner
 * JL-84 — archive / unarchive
 * ---------------------------------------------------------------- */
router.patch('/:idOrKey', asyncHandler(async (req, res) => {
  const space = await loadSpace(req.params.idOrKey)
  const role = await resolveSpaceRole(space, req.user)
  if (!space || !role) {
    res.status(404).json({ error: 'Space not found' })
    return
  }
  if (!spaceRoleAtLeast(role, 'Admin')) {
    res.status(403).json({ error: 'Only a Space Admin can change its settings' })
    return
  }

  const sets = []
  const params = []
  const fields = req.body || {}

  if (fields.name !== undefined) {
    const name = String(fields.name || '').trim()
    if (!name) {
      res.status(400).json({ error: 'name cannot be empty' })
      return
    }
    const err = maxLengthError('name', name, SPACE_NAME_MAX)
    if (err) { res.status(400).json({ error: err }); return }
    sets.push('name = ?'); params.push(name)
  }

  if (fields.description !== undefined) {
    const description = String(fields.description || '').trim()
    const err = maxLengthError('description', description, SPACE_DESC_MAX)
    if (err) { res.status(400).json({ error: err }); return }
    sets.push('description = ?'); params.push(description)
  }

  if (fields.ownerEmail !== undefined) {
    const owner = String(fields.ownerEmail || '').trim()
    if (!owner) {
      // A Space with no owner has nobody accountable for it and nobody who can
      // reassign it. Refuse rather than allow an orphan.
      res.status(400).json({ error: 'ownerEmail cannot be empty' })
      return
    }
    sets.push('owner_email = ?'); params.push(owner)
    // The new owner must be able to administer what they now own.
    await run(
      `INSERT INTO space_members (space_id, user_email, role) VALUES (?, ?, 'Admin')
       ON CONFLICT (space_id, user_email) DO UPDATE SET role = 'Admin' RETURNING id`,
      [space.id, owner],
    )
  }

  if (fields.archived !== undefined) {
    sets.push('archived = ?'); params.push(Boolean(fields.archived))
  }

  if (sets.length === 0) {
    res.status(400).json({ error: 'No supported fields to update' })
    return
  }

  sets.push('updated_at = NOW()')
  await run(`UPDATE spaces SET ${sets.join(', ')} WHERE id = ?`, [...params, space.id])
  const row = await get(`SELECT ${SPACE_COLUMNS} FROM spaces WHERE id = ?`, [space.id])
  res.json({ ...row, myRole: role })
}))

/* ---------------------------------------------------------------- *
 * JL-86 — manage members and roles
 * ---------------------------------------------------------------- */
router.post('/:idOrKey/members', asyncHandler(async (req, res) => {
  const space = await loadSpace(req.params.idOrKey)
  const role = await resolveSpaceRole(space, req.user)
  if (!space || !role) {
    res.status(404).json({ error: 'Space not found' })
    return
  }
  if (!spaceRoleAtLeast(role, 'Admin')) {
    res.status(403).json({ error: 'Only a Space Admin can manage members' })
    return
  }

  const email = String(req.body?.email || '').trim()
  const memberRole = String(req.body?.role || 'Member').trim()
  if (!email) {
    res.status(400).json({ error: 'email is required' })
    return
  }
  if (!SPACE_ROLES.includes(memberRole)) {
    res.status(400).json({ error: `role must be one of: ${SPACE_ROLES.join(', ')}` })
    return
  }

  await run(
    `INSERT INTO space_members (space_id, user_email, role) VALUES (?, ?, ?)
     ON CONFLICT (space_id, user_email) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
    [space.id, email, memberRole],
  )
  const members = await all(
    'SELECT id, user_email, role, created_at FROM space_members WHERE space_id = ? ORDER BY user_email ASC',
    [space.id],
  )
  res.status(201).json(members)
}))

router.delete('/:idOrKey/members/:email', asyncHandler(async (req, res) => {
  const space = await loadSpace(req.params.idOrKey)
  const role = await resolveSpaceRole(space, req.user)
  if (!space || !role) {
    res.status(404).json({ error: 'Space not found' })
    return
  }
  if (!spaceRoleAtLeast(role, 'Admin')) {
    res.status(403).json({ error: 'Only a Space Admin can manage members' })
    return
  }

  const email = String(req.params.email || '').trim()
  if (String(space.owner_email || '').toLowerCase() === email.toLowerCase()) {
    // Removing the owner's membership would leave a Space owned by someone the
    // access check no longer recognises. Reassign ownership first (JL-83).
    res.status(409).json({ error: 'Reassign ownership before removing the owner' })
    return
  }
  await run('DELETE FROM space_members WHERE space_id = ? AND LOWER(user_email) = LOWER(?)', [space.id, email])
  res.json({ ok: true })
}))

export default router
