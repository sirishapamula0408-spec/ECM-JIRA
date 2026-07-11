import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

/**
 * Pure, unit-testable validator for an app listing payload.
 * Rules: `key` and `name` are required; `key` must be slug-like (^[a-z0-9-]+$).
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateAppListing(body) {
  const errors = []
  const b = body || {}
  const key = typeof b.key === 'string' ? b.key.trim() : ''
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!key) errors.push('key is required')
  else if (!/^[a-z0-9-]+$/.test(key)) errors.push('key must be slug-like (lowercase letters, numbers, hyphens)')
  if (!name) errors.push('name is required')
  return { ok: errors.length === 0, errors }
}

const router = Router()

// GET /api/marketplace/apps — browse catalog (?search, ?category)
router.get('/marketplace/apps', asyncHandler(async (req, res) => {
  const { search, category } = req.query
  let sql = 'SELECT id, key, name, vendor, description, category, icon, version, config_schema, created_at FROM marketplace_apps'
  const where = []
  const params = []
  if (search) {
    where.push('(name ILIKE ? OR description ILIKE ? OR vendor ILIKE ?)')
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  if (category) {
    where.push('category = ?')
    params.push(category)
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ' ORDER BY name ASC'
  const rows = await all(sql, params)
  res.json(rows)
}))

// GET /api/marketplace/apps/:key — single listing by key
router.get('/marketplace/apps/:key', asyncHandler(async (req, res) => {
  const row = await get(
    'SELECT id, key, name, vendor, description, category, icon, version, config_schema, created_at FROM marketplace_apps WHERE key = ?',
    [req.params.key],
  )
  if (!row) {
    res.status(404).json({ error: 'App not found' })
    return
  }
  res.json(row)
}))

// POST /api/marketplace/apps — register a new listing (Admin only)
router.post('/marketplace/apps', requireRole('Admin'), asyncHandler(async (req, res) => {
  const check = validateAppListing(req.body)
  if (!check.ok) {
    res.status(400).json({ error: 'Invalid app listing', errors: check.errors })
    return
  }
  const { key, name, vendor, description, category, icon, version, config_schema } = req.body
  const result = await run(
    `INSERT INTO marketplace_apps (key, name, vendor, description, category, icon, version, config_schema)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb)`,
    [
      key.trim(),
      name.trim(),
      vendor || '',
      description || '',
      category || '',
      icon || '',
      version || '1.0.0',
      JSON.stringify(config_schema || {}),
    ],
  )
  const row = await get('SELECT * FROM marketplace_apps WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// DELETE /api/marketplace/apps/:id — remove a listing (Admin only)
router.delete('/marketplace/apps/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const result = await run('DELETE FROM marketplace_apps WHERE id = ?', [Number(req.params.id)])
  if (!result.changes) {
    res.status(404).json({ error: 'App not found' })
    return
  }
  res.status(204).end()
}))

// POST /api/marketplace/apps/:id/install — install into current workspace (Admin only, idempotent)
router.post('/marketplace/apps/:id/install', requireRole('Admin'), asyncHandler(async (req, res) => {
  const appId = Number(req.params.id)
  const app = await get('SELECT id FROM marketplace_apps WHERE id = ?', [appId])
  if (!app) {
    res.status(404).json({ error: 'App not found' })
    return
  }
  const workspaceId = req.workspaceId ?? null
  const config = JSON.stringify(req.body?.config || {})
  await run(
    `INSERT INTO installed_apps (app_id, workspace_id, config, enabled, installed_by)
     VALUES (?, ?, ?::jsonb, TRUE, ?)
     ON CONFLICT (app_id, workspace_id)
     DO UPDATE SET config = EXCLUDED.config, enabled = TRUE`,
    [appId, workspaceId, config, req.user?.email || null],
  )
  const row = await get(
    'SELECT * FROM installed_apps WHERE app_id = ? AND workspace_id IS NOT DISTINCT FROM ?',
    [appId, workspaceId],
  )
  res.status(201).json(row)
}))

// POST /api/marketplace/apps/:id/uninstall — remove install from current workspace (Admin only)
router.post('/marketplace/apps/:id/uninstall', requireRole('Admin'), asyncHandler(async (req, res) => {
  const appId = Number(req.params.id)
  const workspaceId = req.workspaceId ?? null
  const result = await run(
    'DELETE FROM installed_apps WHERE app_id = ? AND workspace_id IS NOT DISTINCT FROM ?',
    [appId, workspaceId],
  )
  if (!result.changes) {
    res.status(404).json({ error: 'App not installed' })
    return
  }
  res.status(204).end()
}))

// GET /api/marketplace/installed — list installed apps for current workspace
router.get('/marketplace/installed', asyncHandler(async (req, res) => {
  const workspaceId = req.workspaceId ?? null
  const rows = await all(
    `SELECT ia.id, ia.app_id, ia.workspace_id, ia.config, ia.enabled, ia.installed_by, ia.installed_at,
            ma.key, ma.name, ma.vendor, ma.description, ma.category, ma.icon, ma.version
     FROM installed_apps ia
     JOIN marketplace_apps ma ON ma.id = ia.app_id
     WHERE ia.workspace_id IS NOT DISTINCT FROM ?
     ORDER BY ma.name ASC`,
    [workspaceId],
  )
  res.json(rows)
}))

// PATCH /api/marketplace/installed/:id — toggle enabled / update config (Admin only)
router.patch('/marketplace/installed/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM installed_apps WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Installed app not found' })
    return
  }
  const sets = []
  const params = []
  if (typeof req.body?.enabled === 'boolean') {
    sets.push('enabled = ?')
    params.push(req.body.enabled)
  }
  if (req.body?.config !== undefined) {
    sets.push('config = ?::jsonb')
    params.push(JSON.stringify(req.body.config || {}))
  }
  if (!sets.length) {
    res.json(existing)
    return
  }
  params.push(id)
  await run(`UPDATE installed_apps SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get('SELECT * FROM installed_apps WHERE id = ?', [id])
  res.json(row)
}))

export default router
