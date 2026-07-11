import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

// JL-131: Issue-level security schemes.
// Security-level catalog CRUD (Admin-gated) + setting an issue's level.
// Mounted at /api so its absolute sub-paths (/security-levels, /issues/:id/...)
// live alongside the other issue-scoped routers.
const router = Router()

function mapLevel(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    createdAt: row.created_at,
  }
}

// GET /api/security-levels — list all levels (any authenticated user; needed so
// the issue-detail selector can render the available options).
router.get(
  '/security-levels',
  asyncHandler(async (req, res) => {
    const rows = await all(
      'SELECT id, name, description, created_at FROM security_levels ORDER BY name ASC',
    )
    res.json(rows.map(mapLevel))
  }),
)

// POST /api/security-levels — create a level (Admin only).
router.post(
  '/security-levels',
  requireRole('Admin'),
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim()
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    const description = req.body?.description
      ? String(req.body.description).trim()
      : null
    const created = await run(
      'INSERT INTO security_levels (name, description) VALUES (?, ?)',
      [name, description],
    )
    const row = await get(
      'SELECT id, name, description, created_at FROM security_levels WHERE id = ?',
      [created.lastID],
    )
    res.status(201).json(mapLevel(row))
  }),
)

// DELETE /api/security-levels/:id — delete a level (Admin only). Any issue that
// referenced it is reset to public (NULL) first so it becomes visible again.
router.delete(
  '/security-levels/:id',
  requireRole('Admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid id' })
      return
    }
    const existing = await get('SELECT id FROM security_levels WHERE id = ?', [id])
    if (!existing) {
      res.status(404).json({ error: 'Security level not found' })
      return
    }
    await run('UPDATE issues SET security_level_id = NULL WHERE security_level_id = ?', [id])
    await run('DELETE FROM security_levels WHERE id = ?', [id])
    res.json({ success: true, id })
  }),
)

// PUT /api/issues/:id/security-level — set or clear an issue's level (Admin).
// Body: { securityLevelId: number|null }. Passing null/''/omitting clears it.
router.put(
  '/issues/:id/security-level',
  requireRole('Admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid issue id' })
      return
    }
    const issue = await get('SELECT id FROM issues WHERE id = ?', [id])
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' })
      return
    }

    const raw = req.body?.securityLevelId
    let levelId = null
    if (raw !== null && raw !== undefined && raw !== '') {
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        res.status(400).json({ error: 'securityLevelId must be a positive integer or null' })
        return
      }
      const level = await get('SELECT id FROM security_levels WHERE id = ?', [parsed])
      if (!level) {
        res.status(400).json({ error: 'Security level not found' })
        return
      }
      levelId = parsed
    }

    await run('UPDATE issues SET security_level_id = ? WHERE id = ?', [levelId, id])
    const row = await get(
      'SELECT id, issue_key, security_level_id FROM issues WHERE id = ?',
      [id],
    )
    res.json({
      id: row.id,
      key: row.issue_key,
      securityLevelId: row.security_level_id ?? null,
    })
  }),
)

export default router
