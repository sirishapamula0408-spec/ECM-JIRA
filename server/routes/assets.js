import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { requireFields, oneOf } from '../utils/validation.js'

const router = Router()

// Allowed asset lifecycle states.
export const ASSET_STATUSES = ['active', 'inactive', 'maintenance', 'retired']

/**
 * Pure, unit-testable validator for an asset create/update payload.
 *
 * @param {object} body            The request body.
 * @param {Array<number>} knownTypeIds  Ids of asset types that currently exist.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateAssetPayload(body = {}, knownTypeIds = []) {
  const { errors } = requireFields(body, ['name'])

  const typeId = Number(body.asset_type_id ?? body.assetTypeId)
  if (!Number.isInteger(typeId) || !knownTypeIds.map(Number).includes(typeId)) {
    errors.push('asset_type must be a known asset type')
  }

  if (body.status !== undefined && body.status !== null && body.status !== '') {
    if (!oneOf(String(body.status), ASSET_STATUSES)) {
      errors.push(`status must be one of: ${ASSET_STATUSES.join(', ')}`)
    }
  }

  return { ok: errors.length === 0, errors }
}

/* ============================ Asset types ============================ */

// GET /api/asset-types — list all asset types (with asset counts)
router.get('/asset-types', asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT t.id, t.name, t.icon, t.created_at,
            COUNT(a.id)::int AS "assetCount"
     FROM asset_types t
     LEFT JOIN assets a ON a.asset_type_id = t.id
     GROUP BY t.id
     ORDER BY t.name ASC`,
  )
  res.json(rows)
}))

// POST /api/asset-types (Admin) — create an asset type
router.post('/asset-types', requireRole('Admin'), asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const icon = String(req.body?.icon || '').trim()
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const created = await run(
    'INSERT INTO asset_types (name, icon) VALUES (?, ?)',
    [name, icon],
  )
  const row = await get('SELECT id, name, icon, created_at FROM asset_types WHERE id = ?', [created.lastID])
  res.status(201).json(row)
}))

/* ============================== Assets =============================== */

// GET /api/assets — list assets (?search= by name, ?type= asset_type_id)
router.get('/assets', asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim()
  const type = req.query.type ? Number(req.query.type) : null
  const params = []
  const where = []
  if (search) {
    where.push('a.name ILIKE ?')
    params.push(`%${search}%`)
  }
  if (Number.isInteger(type)) {
    where.push('a.asset_type_id = ?')
    params.push(type)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = await all(
    `SELECT a.id, a.asset_type_id, a.name, a.status, a.attributes, a.owner_email,
            a.created_at, a.updated_at, t.name AS "typeName", t.icon AS "typeIcon"
     FROM assets a
     LEFT JOIN asset_types t ON t.id = a.asset_type_id
     ${clause}
     ORDER BY a.name ASC`,
    params,
  )
  res.json(rows)
}))

// GET /api/assets/:id — single asset
router.get('/assets/:id', asyncHandler(async (req, res) => {
  const row = await get(
    `SELECT a.id, a.asset_type_id, a.name, a.status, a.attributes, a.owner_email,
            a.created_at, a.updated_at, t.name AS "typeName", t.icon AS "typeIcon"
     FROM assets a
     LEFT JOIN asset_types t ON t.id = a.asset_type_id
     WHERE a.id = ?`,
    [Number(req.params.id)],
  )
  if (!row) {
    res.status(404).json({ error: 'Asset not found' })
    return
  }
  res.json(row)
}))

// POST /api/assets — create an asset
router.post('/assets', asyncHandler(async (req, res) => {
  const typeIds = (await all('SELECT id FROM asset_types')).map((r) => r.id)
  const { ok, errors } = validateAssetPayload(req.body || {}, typeIds)
  if (!ok) {
    res.status(400).json({ error: errors.join('; '), errors })
    return
  }
  const name = String(req.body.name).trim()
  const typeId = Number(req.body.asset_type_id ?? req.body.assetTypeId)
  const status = req.body.status ? String(req.body.status) : 'active'
  const attributes = req.body.attributes && typeof req.body.attributes === 'object' ? req.body.attributes : {}
  const ownerEmail = String(req.body.owner_email ?? req.body.ownerEmail ?? '').trim()

  const created = await run(
    `INSERT INTO assets (asset_type_id, name, status, attributes, owner_email)
     VALUES (?, ?, ?, ?::jsonb, ?)`,
    [typeId, name, status, JSON.stringify(attributes), ownerEmail],
  )
  const row = await get('SELECT * FROM assets WHERE id = ?', [created.lastID])
  res.status(201).json(row)
}))

// PATCH /api/assets/:id — update an asset
router.patch('/assets/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM assets WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Asset not found' })
    return
  }

  const fields = []
  const params = []

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim()
    if (!name) {
      res.status(400).json({ error: 'name cannot be empty' })
      return
    }
    fields.push('name = ?')
    params.push(name)
  }
  if (req.body.asset_type_id !== undefined || req.body.assetTypeId !== undefined) {
    const typeId = Number(req.body.asset_type_id ?? req.body.assetTypeId)
    const known = await get('SELECT id FROM asset_types WHERE id = ?', [typeId])
    if (!known) {
      res.status(400).json({ error: 'asset_type must be a known asset type' })
      return
    }
    fields.push('asset_type_id = ?')
    params.push(typeId)
  }
  if (req.body.status !== undefined) {
    if (!ASSET_STATUSES.includes(String(req.body.status))) {
      res.status(400).json({ error: `status must be one of: ${ASSET_STATUSES.join(', ')}` })
      return
    }
    fields.push('status = ?')
    params.push(String(req.body.status))
  }
  if (req.body.attributes !== undefined) {
    const attributes = req.body.attributes && typeof req.body.attributes === 'object' ? req.body.attributes : {}
    fields.push('attributes = ?::jsonb')
    params.push(JSON.stringify(attributes))
  }
  if (req.body.owner_email !== undefined || req.body.ownerEmail !== undefined) {
    fields.push('owner_email = ?')
    params.push(String(req.body.owner_email ?? req.body.ownerEmail ?? '').trim())
  }

  if (fields.length === 0) {
    res.json(existing)
    return
  }
  fields.push('updated_at = NOW()')
  params.push(id)
  await run(`UPDATE assets SET ${fields.join(', ')} WHERE id = ?`, params)
  const row = await get('SELECT * FROM assets WHERE id = ?', [id])
  res.json(row)
}))

// DELETE /api/assets/:id — delete an asset (cascades issue_assets)
router.delete('/assets/:id', asyncHandler(async (req, res) => {
  await run('DELETE FROM assets WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

/* ==================== Issue <-> Asset linking ====================== */

// GET /api/issues/:id/assets — assets affected by an issue
router.get('/issues/:id/assets', asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT a.id, a.asset_type_id, a.name, a.status, a.attributes, a.owner_email,
            t.name AS "typeName", t.icon AS "typeIcon"
     FROM issue_assets ia
     JOIN assets a ON a.id = ia.asset_id
     LEFT JOIN asset_types t ON t.id = a.asset_type_id
     WHERE ia.issue_id = ?
     ORDER BY a.name ASC`,
    [Number(req.params.id)],
  )
  res.json(rows)
}))

// POST /api/issues/:id/assets — link an asset to an issue. Body: { assetId }
router.post('/issues/:id/assets', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.id)
  const assetId = Number(req.body?.assetId ?? req.body?.asset_id)
  if (!Number.isInteger(assetId)) {
    res.status(400).json({ error: 'assetId is required' })
    return
  }
  const asset = await get('SELECT id FROM assets WHERE id = ?', [assetId])
  if (!asset) {
    res.status(404).json({ error: 'Asset not found' })
    return
  }
  await run(
    // Explicit RETURNING so run() doesn't inject "RETURNING id" (composite PK, no id column).
    'INSERT INTO issue_assets (issue_id, asset_id) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING asset_id',
    [issueId, assetId],
  )
  const rows = await all(
    `SELECT a.id, a.asset_type_id, a.name, a.status, a.attributes, a.owner_email,
            t.name AS "typeName", t.icon AS "typeIcon"
     FROM issue_assets ia
     JOIN assets a ON a.id = ia.asset_id
     LEFT JOIN asset_types t ON t.id = a.asset_type_id
     WHERE ia.issue_id = ?
     ORDER BY a.name ASC`,
    [issueId],
  )
  res.status(201).json(rows)
}))

// DELETE /api/issues/:id/assets/:assetId — unlink an asset from an issue
router.delete('/issues/:id/assets/:assetId', asyncHandler(async (req, res) => {
  await run(
    'DELETE FROM issue_assets WHERE issue_id = ? AND asset_id = ?',
    [Number(req.params.id), Number(req.params.assetId)],
  )
  res.json({ success: true })
}))

export default router
