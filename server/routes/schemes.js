import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

/**
 * Role hierarchy used to resolve grants. Lead is treated as an Admin-equivalent
 * project role. Higher rank = more privilege.
 */
export const ROLE_RANK = {
  Viewer: 1,
  Member: 2,
  Lead: 3,
  Admin: 3,
  Owner: 4,
}

/**
 * The canonical set of capability keys managed by permission schemes.
 * These mirror the booleans exposed by the fixed role→capability map.
 */
export const PERMISSION_KEYS = [
  'issue.create',
  'issue.edit',
  'issue.delete',
  'comment.add',
  'sprints.manage',
  'project.settings',
  'members.manage',
  'workflows.edit',
]

/** Roles that effective-permission maps are resolved for. */
export const RESOLVABLE_ROLES = ['Viewer', 'Member', 'Admin', 'Lead']

/**
 * Pure helper (exported for unit testing): does `role` hold `permissionKey`
 * given a list of grant rows `{ permission_key, role }`?
 *
 * A grant records the MINIMUM role that holds a capability; any role whose rank
 * is >= the lowest granted role's rank for that key qualifies. This mirrors the
 * `requireRole` minimum-role semantics without changing existing behaviour.
 *
 * @param {Array<{permission_key: string, role: string}>} grants
 * @param {string} role
 * @param {string} permissionKey
 * @returns {boolean}
 */
export function roleHasPermission(grants, role, permissionKey) {
  if (!Array.isArray(grants) || !role || !permissionKey) return false
  const roleRank = ROLE_RANK[role] || 0
  if (roleRank === 0) return false
  const matching = grants.filter((g) => g.permission_key === permissionKey)
  if (matching.length === 0) return false
  const minRequiredRank = Math.min(...matching.map((g) => ROLE_RANK[g.role] || Infinity))
  return roleRank >= minRequiredRank
}

/**
 * Resolve a set of grants into a role → capability-map object for every
 * resolvable role, e.g. { Member: { 'issue.create': true, ... }, Admin: {...} }.
 */
export function resolveEffectivePermissions(grants) {
  const map = {}
  for (const role of RESOLVABLE_ROLES) {
    map[role] = {}
    for (const key of PERMISSION_KEYS) {
      map[role][key] = roleHasPermission(grants, role, key)
    }
  }
  return map
}

const router = Router()

/* ================================================================
   Permission Schemes
   ================================================================ */

// GET /api/schemes/permission — list permission schemes
router.get('/schemes/permission', asyncHandler(async (_req, res) => {
  const rows = await all(
    'SELECT id, name, description, is_default, created_at FROM permission_schemes ORDER BY is_default DESC, id ASC',
  )
  res.json(rows)
}))

// GET /api/schemes/permission/:id — a scheme with its grants
router.get('/schemes/permission/:id', asyncHandler(async (req, res) => {
  const scheme = await get('SELECT id, name, description, is_default, created_at FROM permission_schemes WHERE id = ?', [Number(req.params.id)])
  if (!scheme) {
    res.status(404).json({ error: 'Permission scheme not found' })
    return
  }
  const grants = await all('SELECT id, scheme_id, permission_key, role FROM permission_grants WHERE scheme_id = ? ORDER BY id ASC', [scheme.id])
  res.json({ ...scheme, grants })
}))

// POST /api/schemes/permission — create a permission scheme (Admin only)
router.post('/schemes/permission', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { name, description = '' } = req.body
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const result = await run(
    'INSERT INTO permission_schemes (name, description, is_default) VALUES (?, ?, FALSE)',
    [name.trim(), description],
  )
  const row = await get('SELECT id, name, description, is_default, created_at FROM permission_schemes WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// PATCH /api/schemes/permission/:id — rename / edit description (Admin only)
router.patch('/schemes/permission/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT id FROM permission_schemes WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Permission scheme not found' })
    return
  }
  const { name, description } = req.body
  await run(
    'UPDATE permission_schemes SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?',
    [name?.trim() || null, description ?? null, id],
  )
  const row = await get('SELECT id, name, description, is_default, created_at FROM permission_schemes WHERE id = ?', [id])
  res.json(row)
}))

// DELETE /api/schemes/permission/:id — delete a scheme (Admin only; not the default)
router.delete('/schemes/permission/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const scheme = await get('SELECT id, is_default FROM permission_schemes WHERE id = ?', [id])
  if (!scheme) {
    res.status(404).json({ error: 'Permission scheme not found' })
    return
  }
  if (scheme.is_default) {
    res.status(400).json({ error: 'Cannot delete the default permission scheme' })
    return
  }
  await run('DELETE FROM permission_schemes WHERE id = ?', [id])
  res.json({ success: true })
}))

// POST /api/schemes/permission/:id/grants — add a grant (Admin only)
router.post('/schemes/permission/:id/grants', requireRole('Admin'), asyncHandler(async (req, res) => {
  const schemeId = Number(req.params.id)
  const { permissionKey, role } = req.body
  if (!PERMISSION_KEYS.includes(permissionKey)) {
    res.status(400).json({ error: `permissionKey must be one of: ${PERMISSION_KEYS.join(', ')}` })
    return
  }
  if (!ROLE_RANK[role]) {
    res.status(400).json({ error: 'role is invalid' })
    return
  }
  const scheme = await get('SELECT id FROM permission_schemes WHERE id = ?', [schemeId])
  if (!scheme) {
    res.status(404).json({ error: 'Permission scheme not found' })
    return
  }
  const result = await run(
    'INSERT INTO permission_grants (scheme_id, permission_key, role) VALUES (?, ?, ?) ON CONFLICT (scheme_id, permission_key, role) DO NOTHING RETURNING id',
    [schemeId, permissionKey, role],
  )
  const row = await get('SELECT id, scheme_id, permission_key, role FROM permission_grants WHERE scheme_id = ? AND permission_key = ? AND role = ?', [schemeId, permissionKey, role])
  res.status(result.lastID ? 201 : 200).json(row)
}))

// DELETE /api/schemes/permission/grants/:grantId — remove a grant (Admin only)
router.delete('/schemes/permission/grants/:grantId', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM permission_grants WHERE id = ?', [Number(req.params.grantId)])
  res.json({ success: true })
}))

/* ================================================================
   Notification Schemes
   ================================================================ */

// GET /api/schemes/notification — list notification schemes
router.get('/schemes/notification', asyncHandler(async (_req, res) => {
  const rows = await all(
    'SELECT id, name, description, is_default, created_at FROM notification_schemes ORDER BY is_default DESC, id ASC',
  )
  res.json(rows)
}))

// GET /api/schemes/notification/:id — a scheme with its rules
router.get('/schemes/notification/:id', asyncHandler(async (req, res) => {
  const scheme = await get('SELECT id, name, description, is_default, created_at FROM notification_schemes WHERE id = ?', [Number(req.params.id)])
  if (!scheme) {
    res.status(404).json({ error: 'Notification scheme not found' })
    return
  }
  const rules = await all('SELECT id, scheme_id, event_key, notify_role FROM notification_rules WHERE scheme_id = ? ORDER BY id ASC', [scheme.id])
  res.json({ ...scheme, rules })
}))

// POST /api/schemes/notification — create (Admin only)
router.post('/schemes/notification', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { name, description = '' } = req.body
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const result = await run(
    'INSERT INTO notification_schemes (name, description, is_default) VALUES (?, ?, FALSE)',
    [name.trim(), description],
  )
  const row = await get('SELECT id, name, description, is_default, created_at FROM notification_schemes WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// PATCH /api/schemes/notification/:id — rename / edit (Admin only)
router.patch('/schemes/notification/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT id FROM notification_schemes WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Notification scheme not found' })
    return
  }
  const { name, description } = req.body
  await run(
    'UPDATE notification_schemes SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?',
    [name?.trim() || null, description ?? null, id],
  )
  const row = await get('SELECT id, name, description, is_default, created_at FROM notification_schemes WHERE id = ?', [id])
  res.json(row)
}))

// DELETE /api/schemes/notification/:id — delete (Admin only; not the default)
router.delete('/schemes/notification/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const scheme = await get('SELECT id, is_default FROM notification_schemes WHERE id = ?', [id])
  if (!scheme) {
    res.status(404).json({ error: 'Notification scheme not found' })
    return
  }
  if (scheme.is_default) {
    res.status(400).json({ error: 'Cannot delete the default notification scheme' })
    return
  }
  await run('DELETE FROM notification_schemes WHERE id = ?', [id])
  res.json({ success: true })
}))

// POST /api/schemes/notification/:id/rules — add a rule (Admin only)
router.post('/schemes/notification/:id/rules', requireRole('Admin'), asyncHandler(async (req, res) => {
  const schemeId = Number(req.params.id)
  const { eventKey, notifyRole } = req.body
  if (!eventKey || !eventKey.trim()) {
    res.status(400).json({ error: 'eventKey is required' })
    return
  }
  if (!ROLE_RANK[notifyRole]) {
    res.status(400).json({ error: 'notifyRole is invalid' })
    return
  }
  const scheme = await get('SELECT id FROM notification_schemes WHERE id = ?', [schemeId])
  if (!scheme) {
    res.status(404).json({ error: 'Notification scheme not found' })
    return
  }
  const result = await run(
    'INSERT INTO notification_rules (scheme_id, event_key, notify_role) VALUES (?, ?, ?) ON CONFLICT (scheme_id, event_key, notify_role) DO NOTHING RETURNING id',
    [schemeId, eventKey.trim(), notifyRole],
  )
  const row = await get('SELECT id, scheme_id, event_key, notify_role FROM notification_rules WHERE scheme_id = ? AND event_key = ? AND notify_role = ?', [schemeId, eventKey.trim(), notifyRole])
  res.status(result.lastID ? 201 : 200).json(row)
}))

// DELETE /api/schemes/notification/rules/:ruleId — remove a rule (Admin only)
router.delete('/schemes/notification/rules/:ruleId', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM notification_rules WHERE id = ?', [Number(req.params.ruleId)])
  res.json({ success: true })
}))

/* ================================================================
   Project assignment + effective permissions
   ================================================================ */

// PUT /api/projects/:id/permission-scheme — assign a scheme to a project (Admin only)
router.put('/projects/:id/permission-scheme', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  const { schemeId } = req.body
  const project = await get('SELECT id FROM projects WHERE id = ?', [projectId])
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }
  if (schemeId != null) {
    const scheme = await get('SELECT id FROM permission_schemes WHERE id = ?', [Number(schemeId)])
    if (!scheme) {
      res.status(400).json({ error: 'Permission scheme not found' })
      return
    }
  }
  await run('UPDATE projects SET permission_scheme_id = ? WHERE id = ?', [schemeId != null ? Number(schemeId) : null, projectId])
  res.json({ success: true, projectId, permissionSchemeId: schemeId != null ? Number(schemeId) : null })
}))

// PUT /api/projects/:id/notification-scheme — assign a scheme to a project (Admin only)
router.put('/projects/:id/notification-scheme', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  const { schemeId } = req.body
  const project = await get('SELECT id FROM projects WHERE id = ?', [projectId])
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }
  if (schemeId != null) {
    const scheme = await get('SELECT id FROM notification_schemes WHERE id = ?', [Number(schemeId)])
    if (!scheme) {
      res.status(400).json({ error: 'Notification scheme not found' })
      return
    }
  }
  await run('UPDATE projects SET notification_scheme_id = ? WHERE id = ?', [schemeId != null ? Number(schemeId) : null, projectId])
  res.json({ success: true, projectId, notificationSchemeId: schemeId != null ? Number(schemeId) : null })
}))

// GET /api/projects/:id/effective-permissions — resolve the project's scheme
// (or the default when unassigned) into a role → capability map.
router.get('/projects/:id/effective-permissions', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  const project = await get('SELECT id, permission_scheme_id FROM projects WHERE id = ?', [projectId])
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  let scheme = null
  if (project.permission_scheme_id) {
    scheme = await get('SELECT id, name, is_default FROM permission_schemes WHERE id = ?', [project.permission_scheme_id])
  }
  // Fall back to the default scheme when the project has none (or a dangling one).
  if (!scheme) {
    scheme = await get('SELECT id, name, is_default FROM permission_schemes WHERE is_default = TRUE ORDER BY id ASC LIMIT 1')
  }

  if (!scheme) {
    // No schemes exist at all — return an all-false map so callers stay safe.
    res.json({ projectId, schemeId: null, schemeName: null, isDefault: false, permissions: resolveEffectivePermissions([]) })
    return
  }

  const grants = await all('SELECT permission_key, role FROM permission_grants WHERE scheme_id = ?', [scheme.id])
  res.json({
    projectId,
    schemeId: scheme.id,
    schemeName: scheme.name,
    isDefault: Boolean(scheme.is_default),
    fallback: !project.permission_scheme_id,
    permissions: resolveEffectivePermissions(grants),
  })
}))

export default router
