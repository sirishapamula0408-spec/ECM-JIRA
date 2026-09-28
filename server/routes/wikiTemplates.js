import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { maxLengthError } from '../utils/validation.js'

/*
 * JL-125→127 — page templates.
 *
 * ── Who can do what ─────────────────────────────────────────────────────────
 *
 * Anyone who can read the wiki can LIST templates — you cannot start a page
 * from a template you cannot see. Creating, editing and deleting is Admin
 * (JL-127): a template is a structure the whole team inherits, and one person
 * reshaping it changes every document written after.
 *
 * ── The shipped seven ───────────────────────────────────────────────────────
 *
 * `is_builtin` rows can be EDITED but not DELETED. A team that has reshaped
 * the SOP template should keep its edits; a team that deletes the set should
 * not have it silently return on the next boot, because the seed is
 * ON CONFLICT DO NOTHING and would simply reinsert it. Refusing the delete is
 * honest about what the system can actually guarantee.
 */

const router = Router()

const NAME_MAX = 120
const DESC_MAX = 500
const BODY_MAX = 50000

/** Columns every response carries. Never SELECT *. */
const TEMPLATE_COLUMNS =
  'id, template_key, name, description, body, is_builtin, created_by, updated_by, created_at, updated_at'

/* ---------------------------------------------------------------- *
 * JL-125 — list (anyone), so a page can be started from one
 * ---------------------------------------------------------------- */
router.get('/', asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT ${TEMPLATE_COLUMNS} FROM wiki_templates ORDER BY is_builtin DESC, name ASC`,
  )
  res.json(rows)
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await get(
    `SELECT ${TEMPLATE_COLUMNS} FROM wiki_templates WHERE id = ?`,
    [Number(req.params.id)],
  )
  if (!row) {
    res.status(404).json({ error: 'Template not found' })
    return
  }
  res.json(row)
}))

/* ---------------------------------------------------------------- *
 * JL-127 — admin management
 * ---------------------------------------------------------------- */
router.post('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const description = String(req.body?.description ?? '').trim()
  const body = String(req.body?.body ?? '')

  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const tooLong = maxLengthError('name', name, NAME_MAX)
    || maxLengthError('description', description, DESC_MAX)
    || maxLengthError('body', body, BODY_MAX)
  if (tooLong) {
    res.status(400).json({ error: tooLong })
    return
  }

  const created = await run(
    `INSERT INTO wiki_templates (template_key, name, description, body, is_builtin, created_by, updated_by)
     VALUES (NULL, ?, ?, ?, FALSE, ?, ?)`,
    [name, description, body, req.user.email, req.user.email],
  )
  const row = await get(
    `SELECT ${TEMPLATE_COLUMNS} FROM wiki_templates WHERE id = ?`,
    [created.lastID],
  )
  res.status(201).json(row)
}))

router.patch('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT id, is_builtin FROM wiki_templates WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Template not found' })
    return
  }

  const { name, description, body } = req.body || {}
  const nextName = name !== undefined ? String(name).trim() : undefined
  if (nextName !== undefined && !nextName) {
    res.status(400).json({ error: 'name cannot be empty' })
    return
  }
  const tooLong = (nextName !== undefined && maxLengthError('name', nextName, NAME_MAX))
    || (description !== undefined && maxLengthError('description', String(description), DESC_MAX))
    || (body !== undefined && maxLengthError('body', String(body), BODY_MAX))
  if (tooLong) {
    res.status(400).json({ error: tooLong })
    return
  }

  const sets = []
  const params = []
  if (nextName !== undefined) { sets.push('name = ?'); params.push(nextName) }
  if (description !== undefined) { sets.push('description = ?'); params.push(String(description).trim()) }
  if (body !== undefined) { sets.push('body = ?'); params.push(String(body)) }

  if (sets.length === 0) {
    const unchanged = await get(`SELECT ${TEMPLATE_COLUMNS} FROM wiki_templates WHERE id = ?`, [id])
    res.json(unchanged)
    return
  }

  sets.push('updated_by = ?', 'updated_at = NOW()')
  params.push(req.user.email, id)

  // A built-in may be edited: a team that reshapes the SOP template keeps
  // those edits, because the seed only inserts what is missing.
  await run(`UPDATE wiki_templates SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get(`SELECT ${TEMPLATE_COLUMNS} FROM wiki_templates WHERE id = ?`, [id])
  res.json(row)
}))

router.delete('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT id, is_builtin FROM wiki_templates WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Template not found' })
    return
  }
  /*
   * Refused rather than allowed-and-reseeded. The boot seed is
   * ON CONFLICT DO NOTHING keyed on template_key, so a deleted built-in would
   * silently reappear on the next restart — a delete that does not stay
   * deleted is worse than one that is declined with a reason.
   */
  if (existing.is_builtin) {
    res.status(409).json({
      error: 'A built-in template cannot be deleted. Edit it instead — it would be restored on the next restart.',
    })
    return
  }
  await run('DELETE FROM wiki_templates WHERE id = ?', [id])
  res.json({ success: true })
}))

export default router
