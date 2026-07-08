import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { VALIDATOR_TYPES, POST_FUNCTION_TYPES } from '../services/workflow.js'

const router = Router()

function mapTransition(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    validators: Array.isArray(row.validators) ? row.validators : (row.validators ?? []),
    postFunctions: Array.isArray(row.post_functions) ? row.post_functions : (row.post_functions ?? []),
    createdAt: row.created_at,
  }
}

// Validate an array of validator specs. Returns an error string or null.
function validateValidators(list) {
  if (!Array.isArray(list)) return 'validators must be an array'
  for (const v of list) {
    if (!v || typeof v !== 'object') return 'each validator must be an object'
    if (!VALIDATOR_TYPES.includes(v.type)) return `validator type must be one of: ${VALIDATOR_TYPES.join(', ')}`
    if (v.type === 'required_field' && !String(v.field || '').trim()) return 'required_field validator needs a field'
  }
  return null
}

// Validate an array of post-function specs. Returns an error string or null.
function validatePostFunctions(list) {
  if (!Array.isArray(list)) return 'postFunctions must be an array'
  for (const f of list) {
    if (!f || typeof f !== 'object') return 'each post-function must be an object'
    if (!POST_FUNCTION_TYPES.includes(f.type)) return `post-function type must be one of: ${POST_FUNCTION_TYPES.join(', ')}`
    if (f.type === 'set_field' && !String(f.field || '').trim()) return 'set_field post-function needs a field'
    if (f.type === 'add_comment' && !String(f.text || '').trim()) return 'add_comment post-function needs text'
  }
  return null
}

// GET /api/projects/:projectId/workflow-transitions — list transitions for a project
router.get('/projects/:projectId/workflow-transitions', asyncHandler(async (req, res) => {
  const rows = await all(
    'SELECT * FROM workflow_transitions WHERE project_id = ? ORDER BY id ASC',
    [Number(req.params.projectId)],
  )
  res.json(rows.map(mapTransition))
}))

// POST /api/projects/:projectId/workflow-transitions (Admin) — create a transition
router.post('/projects/:projectId/workflow-transitions', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const fromStatus = String(req.body?.fromStatus || '').trim()
  const toStatus = String(req.body?.toStatus || '').trim()
  const validators = req.body?.validators ?? []
  const postFunctions = req.body?.postFunctions ?? []

  if (!fromStatus || !toStatus) {
    res.status(400).json({ error: 'fromStatus and toStatus are required' })
    return
  }
  if (fromStatus === toStatus) {
    res.status(400).json({ error: 'fromStatus and toStatus must differ' })
    return
  }
  const vErr = validateValidators(validators)
  if (vErr) { res.status(400).json({ error: vErr }); return }
  const pErr = validatePostFunctions(postFunctions)
  if (pErr) { res.status(400).json({ error: pErr }); return }

  const created = await run(
    'INSERT INTO workflow_transitions (project_id, from_status, to_status, validators, post_functions) VALUES (?, ?, ?, ?::jsonb, ?::jsonb)',
    [projectId, fromStatus, toStatus, JSON.stringify(validators), JSON.stringify(postFunctions)],
  )
  const row = await get('SELECT * FROM workflow_transitions WHERE id = ?', [created.lastID])
  res.status(201).json(mapTransition(row))
}))

// PATCH /api/workflow-transitions/:id (Admin) — edit validators / post-functions
router.patch('/workflow-transitions/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM workflow_transitions WHERE id = ?', [id])
  if (!existing) { res.status(404).json({ error: 'Transition not found' }); return }

  const sets = []
  const params = []
  if (req.body?.validators !== undefined) {
    const err = validateValidators(req.body.validators)
    if (err) { res.status(400).json({ error: err }); return }
    sets.push('validators = ?::jsonb')
    params.push(JSON.stringify(req.body.validators))
  }
  if (req.body?.postFunctions !== undefined) {
    const err = validatePostFunctions(req.body.postFunctions)
    if (err) { res.status(400).json({ error: err }); return }
    sets.push('post_functions = ?::jsonb')
    params.push(JSON.stringify(req.body.postFunctions))
  }
  if (sets.length === 0) { res.json(mapTransition(existing)); return }

  params.push(id)
  await run(`UPDATE workflow_transitions SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get('SELECT * FROM workflow_transitions WHERE id = ?', [id])
  res.json(mapTransition(row))
}))

// DELETE /api/workflow-transitions/:id (Admin)
router.delete('/workflow-transitions/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM workflow_transitions WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

export default router
