import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

// JL-37 base types + JL-113 extended types
const FIELD_TYPES = [
  'text', 'number', 'date', 'dropdown',
  'multi_select', 'labels', 'user_picker', 'cascading_select', 'calculated',
]
// Types whose stored value is a JSON blob (array / object) rather than a plain scalar
const JSON_VALUE_TYPES = new Set(['multi_select', 'labels', 'cascading_select'])

function parseJson(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return null }
}

function mapField(row) {
  const config = parseJson(row.config) || {}
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    fieldType: row.field_type,
    options: parseJson(row.options) || [],
    config,
    formula: config.formula || null,
    readOnly: row.field_type === 'calculated',
  }
}

/* ----------------------------- formula engine ----------------------------- */
// Safe arithmetic evaluator over other numeric fields, no eval().
// Formula tokens: {<fieldId>} referencing another field's numeric value.
// Supports + - * / and parentheses.
function computeArithmetic(expr) {
  if (!/^[\d.+\-*/()\s]+$/.test(expr)) return null
  const tokens = expr.match(/\d+(?:\.\d+)?|[+\-*/()]/g)
  if (!tokens) return null
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2 }
  const output = []
  const ops = []
  for (const t of tokens) {
    if (/^\d/.test(t)) {
      output.push(Number(t))
    } else if (t === '(') {
      ops.push(t)
    } else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop())
      if (!ops.length) return null
      ops.pop()
    } else {
      while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t]) {
        output.push(ops.pop())
      }
      ops.push(t)
    }
  }
  while (ops.length) {
    const op = ops.pop()
    if (op === '(') return null
    output.push(op)
  }
  const stack = []
  for (const tok of output) {
    if (typeof tok === 'number') {
      stack.push(tok)
    } else {
      const b = stack.pop()
      const a = stack.pop()
      if (a === undefined || b === undefined) return null
      const r = op(tok, a, b)
      if (r === null) return null
      stack.push(r)
    }
  }
  return stack.length === 1 ? stack[0] : null
}
function op(o, a, b) {
  switch (o) {
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/': return b === 0 ? null : a / b
    default: return null
  }
}

// values: Map/object of fieldId -> numeric value
function evaluateFormula(formula, values) {
  if (!formula) return null
  const substituted = String(formula).replace(/\{(\d+)\}/g, (_, id) => {
    const v = values[Number(id)]
    return Number.isFinite(v) ? String(v) : '0'
  })
  const result = computeArithmetic(substituted)
  return Number.isFinite(result) ? result : null
}

/* ------------------------------ definitions ------------------------------- */

// GET /api/projects/:projectId/custom-fields — list definitions
router.get('/projects/:projectId/custom-fields', asyncHandler(async (req, res) => {
  const rows = await all(
    'SELECT * FROM custom_fields WHERE project_id = ? ORDER BY id ASC',
    [Number(req.params.projectId)],
  )
  res.json(rows.map(mapField))
}))

// POST /api/projects/:projectId/custom-fields (Admin) — create a definition
router.post('/projects/:projectId/custom-fields', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const name = String(req.body?.name || '').trim()
  const fieldType = String(req.body?.fieldType || '').trim()
  const options = Array.isArray(req.body?.options) ? req.body.options.map((o) => String(o).trim()).filter(Boolean) : []
  const config = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {}

  if (!name) { res.status(400).json({ error: 'Field name is required' }); return }
  if (!FIELD_TYPES.includes(fieldType)) { res.status(400).json({ error: `fieldType must be one of: ${FIELD_TYPES.join(', ')}` }); return }

  if ((fieldType === 'dropdown' || fieldType === 'multi_select') && options.length === 0) {
    res.status(400).json({ error: `${fieldType} fields need at least one option` }); return
  }

  let storedConfig = {}
  if (fieldType === 'cascading_select') {
    const cascade = Array.isArray(config.cascade) ? config.cascade : null
    const valid = cascade && cascade.length > 0 && cascade.every(
      (c) => c && typeof c.parent === 'string' && c.parent.trim() && Array.isArray(c.children),
    )
    if (!valid) { res.status(400).json({ error: 'cascading_select requires config.cascade [{ parent, children: [] }]' }); return }
    storedConfig = { cascade: cascade.map((c) => ({ parent: String(c.parent).trim(), children: c.children.map((x) => String(x).trim()).filter(Boolean) })) }
  } else if (fieldType === 'calculated') {
    const formula = String(config.formula || '').trim()
    if (!formula) { res.status(400).json({ error: 'calculated fields require config.formula' }); return }
    storedConfig = { formula }
  }

  const created = await run(
    'INSERT INTO custom_fields (project_id, name, field_type, options, config) VALUES (?, ?, ?, ?::jsonb, ?::jsonb)',
    [projectId, name, fieldType, JSON.stringify(options), JSON.stringify(storedConfig)],
  )
  const row = await get('SELECT * FROM custom_fields WHERE id = ?', [created.lastID])
  res.status(201).json(mapField(row))
}))

// DELETE /api/custom-fields/:id (Admin)
router.delete('/custom-fields/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM custom_fields WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

/* -------------------------------- values ---------------------------------- */

// GET /api/issues/:issueId/custom-fields — every project field def + this issue's value
router.get('/issues/:issueId/custom-fields', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const issue = await get('SELECT project_id FROM issues WHERE id = ?', [issueId])
  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return }
  const rows = await all(
    `SELECT cf.*, v.value AS field_value
     FROM custom_fields cf
     LEFT JOIN issue_custom_field_values v ON v.field_id = cf.id AND v.issue_id = ?
     WHERE cf.project_id = ?
     ORDER BY cf.id ASC`,
    [issueId, issue.project_id],
  )

  // Build a numeric map (field id -> number) for calculated-field evaluation
  const numericValues = {}
  for (const r of rows) {
    if (r.field_type === 'number' && r.field_value != null && r.field_value !== '') {
      const n = Number(r.field_value)
      if (Number.isFinite(n)) numericValues[r.id] = n
    }
  }

  const result = rows.map((r) => {
    const base = mapField(r)
    let value
    if (r.field_type === 'calculated') {
      value = evaluateFormula(base.formula, numericValues)
    } else if (JSON_VALUE_TYPES.has(r.field_type)) {
      value = parseJson(r.field_value)
      if (value === null) value = r.field_type === 'cascading_select' ? null : []
    } else {
      value = r.field_value ?? ''
    }
    return { ...base, value }
  })
  res.json(result)
}))

// PUT /api/issues/:issueId/custom-fields/:fieldId — set a value (empty clears)
router.put('/issues/:issueId/custom-fields/:fieldId', requireRole('Member'), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const fieldId = Number(req.params.fieldId)
  const raw = req.body?.value

  const field = await get('SELECT * FROM custom_fields WHERE id = ?', [fieldId])
  if (!field) { res.status(404).json({ error: 'Custom field not found' }); return }

  if (field.field_type === 'calculated') {
    res.status(400).json({ error: 'Calculated fields are read-only' }); return
  }

  const options = parseJson(field.options) || []
  const config = parseJson(field.config) || {}

  // Empty / clearing
  const isEmpty = raw === null || raw === undefined || raw === ''
    || (Array.isArray(raw) && raw.length === 0)
  if (isEmpty) {
    await run('DELETE FROM issue_custom_field_values WHERE issue_id = ? AND field_id = ?', [issueId, fieldId])
    res.json({ fieldId, value: null }); return
  }

  let stored
  switch (field.field_type) {
    case 'number': {
      const n = Number(raw)
      if (!Number.isFinite(n)) { res.status(400).json({ error: 'Value must be a number' }); return }
      stored = String(n)
      break
    }
    case 'dropdown': {
      const v = String(raw)
      if (options.length && !options.includes(v)) { res.status(400).json({ error: 'Value must be one of the field options' }); return }
      stored = v
      break
    }
    case 'multi_select': {
      if (!Array.isArray(raw)) { res.status(400).json({ error: 'multi_select value must be an array' }); return }
      const vals = raw.map((x) => String(x))
      if (options.length && !vals.every((v) => options.includes(v))) {
        res.status(400).json({ error: 'All selected values must be valid options' }); return
      }
      stored = JSON.stringify(vals)
      break
    }
    case 'labels': {
      if (!Array.isArray(raw)) { res.status(400).json({ error: 'labels value must be an array' }); return }
      stored = JSON.stringify(raw.map((x) => String(x).trim()).filter(Boolean))
      break
    }
    case 'user_picker': {
      const email = String(raw).trim()
      const member = await get('SELECT id FROM members WHERE LOWER(email) = LOWER(?)', [email])
      if (!member) { res.status(400).json({ error: 'user_picker value must be an existing member email' }); return }
      stored = email
      break
    }
    case 'cascading_select': {
      if (typeof raw !== 'object' || Array.isArray(raw) || raw === null) {
        res.status(400).json({ error: 'cascading_select value must be an object { parent, child }' }); return
      }
      const parent = String(raw.parent || '').trim()
      const child = raw.child === undefined || raw.child === null ? '' : String(raw.child).trim()
      const cascade = Array.isArray(config.cascade) ? config.cascade : []
      const parentEntry = cascade.find((c) => c.parent === parent)
      if (!parentEntry) { res.status(400).json({ error: 'Invalid parent option' }); return }
      if (child && !parentEntry.children.includes(child)) { res.status(400).json({ error: 'Invalid child option for the selected parent' }); return }
      stored = JSON.stringify({ parent, child })
      break
    }
    case 'date':
    case 'text':
    default:
      stored = String(raw)
      break
  }

  await run(
    `INSERT INTO issue_custom_field_values (issue_id, field_id, value) VALUES (?, ?, ?)
     ON CONFLICT (issue_id, field_id) DO UPDATE SET value = EXCLUDED.value RETURNING id`,
    [issueId, fieldId, stored],
  )
  res.json({ fieldId, value: JSON_VALUE_TYPES.has(field.field_type) ? parseJson(stored) : stored })
}))

export default router
