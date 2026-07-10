// JL-145: Plugin/app framework — CRUD for declarative plugin manifests plus a
// read endpoint that returns the merged, safe contributions for one extension
// point (consumed by the frontend to render nav items, issue panels, etc.).
import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import {
  EXTENSION_POINTS,
  validateManifest,
  contributionsFor,
} from '../services/pluginRegistry.js'

const router = Router()

/** Parse a JSONB column that may arrive as a raw string. */
function parseContributions(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return [] }
  }
  return []
}

/** Normalize a DB row into an API-friendly manifest object. */
function toManifest(row) {
  if (!row) return row
  return {
    id: row.id,
    appKey: row.app_key,
    name: row.name,
    version: row.version,
    contributions: parseContributions(row.contributions),
    enabled: row.enabled,
    createdAt: row.created_at,
  }
}

// GET /api/plugins — list all registered manifests.
router.get('/', asyncHandler(async (_req, res) => {
  const rows = await all('SELECT * FROM plugin_manifests ORDER BY created_at DESC')
  res.json(rows.map(toManifest))
}))

// GET /api/plugins/extension-points — the known extension points.
router.get('/extension-points', asyncHandler(async (_req, res) => {
  res.json(EXTENSION_POINTS)
}))

// GET /api/plugins/contributions/:extensionPoint — merged safe contributions.
router.get('/contributions/:extensionPoint', asyncHandler(async (req, res) => {
  const { extensionPoint } = req.params
  if (!EXTENSION_POINTS.includes(extensionPoint)) {
    res.status(400).json({ error: `Unknown extension point: ${extensionPoint}` })
    return
  }
  const rows = await all('SELECT * FROM plugin_manifests WHERE enabled = TRUE')
  res.json(contributionsFor(rows, extensionPoint))
}))

// GET /api/plugins/:id — a single manifest.
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM plugin_manifests WHERE id = ?', [Number(req.params.id)])
  if (!row) {
    res.status(404).json({ error: 'Plugin manifest not found' })
    return
  }
  res.json(toManifest(row))
}))

// POST /api/plugins — register a manifest (Admin).
router.post('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { appKey = null, name, version = '1.0.0', contributions = [], enabled = true } = req.body || {}
  const manifest = { name, contributions }
  const { ok, errors } = validateManifest(manifest)
  if (!ok) {
    res.status(400).json({ error: 'Invalid manifest', errors })
    return
  }
  const result = await run(
    'INSERT INTO plugin_manifests (app_key, name, version, contributions, enabled) VALUES (?, ?, ?, ?::jsonb, ?)',
    [appKey, name.trim(), version, JSON.stringify(contributions), enabled !== false],
  )
  const row = await get('SELECT * FROM plugin_manifests WHERE id = ?', [result.lastID])
  res.status(201).json(toManifest(row))
}))

// PATCH /api/plugins/:id — enable/disable or update a manifest (Admin).
router.patch('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM plugin_manifests WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Plugin manifest not found' })
    return
  }

  const { name, version, contributions, enabled, appKey } = req.body || {}

  // When name/contributions change, re-validate the resulting manifest.
  if (name !== undefined || contributions !== undefined) {
    const candidate = {
      name: name !== undefined ? name : existing.name,
      contributions: contributions !== undefined ? contributions : parseContributions(existing.contributions),
    }
    const { ok, errors } = validateManifest(candidate)
    if (!ok) {
      res.status(400).json({ error: 'Invalid manifest', errors })
      return
    }
  }

  const sets = []
  const params = []
  if (appKey !== undefined) { sets.push('app_key = ?'); params.push(appKey) }
  if (name !== undefined) { sets.push('name = ?'); params.push(name.trim()) }
  if (version !== undefined) { sets.push('version = ?'); params.push(version) }
  if (contributions !== undefined) { sets.push('contributions = ?::jsonb'); params.push(JSON.stringify(contributions)) }
  if (enabled !== undefined) { sets.push('enabled = ?'); params.push(enabled !== false) }

  if (sets.length === 0) {
    res.json(toManifest(existing))
    return
  }

  params.push(id)
  await run(`UPDATE plugin_manifests SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get('SELECT * FROM plugin_manifests WHERE id = ?', [id])
  res.json(toManifest(row))
}))

// DELETE /api/plugins/:id — unregister a manifest (Admin).
router.delete('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM plugin_manifests WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

export default router
