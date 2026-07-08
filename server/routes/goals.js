import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

const STATUSES = ['on_track', 'at_risk', 'off_track', 'done']

function mapKeyResult(row) {
  const target = Number(row.target_value)
  const current = Number(row.current_value)
  const ratio = target > 0 ? Math.min(current / target, 1) : 0
  return {
    id: row.id,
    goalId: row.goal_id,
    title: row.title,
    targetValue: target,
    currentValue: current,
    unit: row.unit || '',
    issueId: row.issue_id ?? null,
    progress: Math.round(ratio * 100),
  }
}

// Progress % of a goal = average of its key results' completion ratios (current/target), 0 if none.
function computeProgress(keyResults) {
  if (!keyResults.length) return 0
  const sum = keyResults.reduce((acc, kr) => acc + kr.progress, 0)
  return Math.round(sum / keyResults.length)
}

function mapGoal(row, keyResults = []) {
  return {
    id: row.id,
    projectId: row.project_id,
    objective: row.objective,
    description: row.description || '',
    owner: row.owner || '',
    status: row.status,
    dueDate: row.due_date,
    createdAt: row.created_at,
    keyResults,
    progress: computeProgress(keyResults),
  }
}

async function keyResultsForGoal(goalId) {
  const rows = await all('SELECT * FROM key_results WHERE goal_id = ? ORDER BY id ASC', [goalId])
  return rows.map(mapKeyResult)
}

// GET /api/projects/:projectId/goals — list goals with key results + computed progress %
router.get('/projects/:projectId/goals', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const goals = await all(
    'SELECT * FROM goals WHERE project_id = ? ORDER BY created_at DESC, id DESC',
    [projectId],
  )
  const krRows = await all(
    `SELECT kr.* FROM key_results kr
     JOIN goals g ON g.id = kr.goal_id
     WHERE g.project_id = ? ORDER BY kr.id ASC`,
    [projectId],
  )
  const byGoal = {}
  for (const r of krRows) {
    const mapped = mapKeyResult(r)
    if (!byGoal[mapped.goalId]) byGoal[mapped.goalId] = []
    byGoal[mapped.goalId].push(mapped)
  }
  res.json(goals.map((g) => mapGoal(g, byGoal[g.id] || [])))
}))

// GET /api/goals/:id — a single goal with key results + progress
router.get('/goals/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const row = await get('SELECT * FROM goals WHERE id = ?', [id])
  if (!row) { res.status(404).json({ error: 'Goal not found' }); return }
  res.json(mapGoal(row, await keyResultsForGoal(id)))
}))

// POST /api/projects/:projectId/goals (Member+) — create an objective
router.post('/projects/:projectId/goals', requireRole('Member', 'Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const objective = String(req.body?.objective || '').trim()
  const description = String(req.body?.description || '').trim()
  const owner = String(req.body?.owner || '').trim()
  const status = String(req.body?.status || 'on_track').trim()
  const dueDate = req.body?.dueDate ? String(req.body.dueDate).trim() : null

  if (!objective) { res.status(400).json({ error: 'Objective is required' }); return }
  if (!STATUSES.includes(status)) { res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` }); return }

  const created = await run(
    'INSERT INTO goals (project_id, objective, description, owner, status, due_date) VALUES (?, ?, ?, ?, ?, ?)',
    [projectId, objective, description, owner, status, dueDate],
  )
  const row = await get('SELECT * FROM goals WHERE id = ?', [created.lastID])
  res.status(201).json(mapGoal(row, []))
}))

// PATCH /api/goals/:id (Member+) — update objective/description/owner/status/due date
router.patch('/goals/:id', requireRole('Member', 'Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM goals WHERE id = ?', [id])
  if (!existing) { res.status(404).json({ error: 'Goal not found' }); return }

  const objective = req.body?.objective !== undefined ? String(req.body.objective).trim() : existing.objective
  const description = req.body?.description !== undefined ? String(req.body.description).trim() : existing.description
  const owner = req.body?.owner !== undefined ? String(req.body.owner).trim() : existing.owner
  const status = req.body?.status !== undefined ? String(req.body.status).trim() : existing.status
  const dueDate = req.body?.dueDate !== undefined
    ? (req.body.dueDate ? String(req.body.dueDate).trim() : null)
    : existing.due_date

  if (!objective) { res.status(400).json({ error: 'Objective is required' }); return }
  if (!STATUSES.includes(status)) { res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` }); return }

  await run(
    'UPDATE goals SET objective = ?, description = ?, owner = ?, status = ?, due_date = ? WHERE id = ?',
    [objective, description, owner, status, dueDate, id],
  )
  const row = await get('SELECT * FROM goals WHERE id = ?', [id])
  res.json(mapGoal(row, await keyResultsForGoal(id)))
}))

// DELETE /api/goals/:id (Admin) — delete a goal (key_results cascade via FK)
router.delete('/goals/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM goals WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

// POST /api/goals/:goalId/key-results (Member+) — add a key result to a goal
router.post('/goals/:goalId/key-results', requireRole('Member', 'Admin'), asyncHandler(async (req, res) => {
  const goalId = Number(req.params.goalId)
  const goal = await get('SELECT id FROM goals WHERE id = ?', [goalId])
  if (!goal) { res.status(404).json({ error: 'Goal not found' }); return }

  const title = String(req.body?.title || '').trim()
  if (!title) { res.status(400).json({ error: 'Key result title is required' }); return }

  const targetValue = req.body?.targetValue !== undefined && req.body.targetValue !== '' ? Number(req.body.targetValue) : 100
  const currentValue = req.body?.currentValue !== undefined && req.body.currentValue !== '' ? Number(req.body.currentValue) : 0
  const unit = String(req.body?.unit || '').trim()
  const issueId = req.body?.issueId ? Number(req.body.issueId) : null

  if (Number.isNaN(targetValue) || Number.isNaN(currentValue)) {
    res.status(400).json({ error: 'targetValue and currentValue must be numbers' }); return
  }

  const created = await run(
    'INSERT INTO key_results (goal_id, title, target_value, current_value, unit, issue_id) VALUES (?, ?, ?, ?, ?, ?)',
    [goalId, title, targetValue, currentValue, unit, issueId],
  )
  const row = await get('SELECT * FROM key_results WHERE id = ?', [created.lastID])
  res.status(201).json(mapKeyResult(row))
}))

// PATCH /api/key-results/:id (Member+) — update a key result (e.g. current_value drives progress)
router.patch('/key-results/:id', requireRole('Member', 'Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM key_results WHERE id = ?', [id])
  if (!existing) { res.status(404).json({ error: 'Key result not found' }); return }

  const title = req.body?.title !== undefined ? String(req.body.title).trim() : existing.title
  const targetValue = req.body?.targetValue !== undefined && req.body.targetValue !== '' ? Number(req.body.targetValue) : Number(existing.target_value)
  const currentValue = req.body?.currentValue !== undefined && req.body.currentValue !== '' ? Number(req.body.currentValue) : Number(existing.current_value)
  const unit = req.body?.unit !== undefined ? String(req.body.unit).trim() : existing.unit
  const issueId = req.body?.issueId !== undefined ? (req.body.issueId ? Number(req.body.issueId) : null) : existing.issue_id

  if (!title) { res.status(400).json({ error: 'Key result title is required' }); return }
  if (Number.isNaN(targetValue) || Number.isNaN(currentValue)) {
    res.status(400).json({ error: 'targetValue and currentValue must be numbers' }); return
  }

  await run(
    'UPDATE key_results SET title = ?, target_value = ?, current_value = ?, unit = ?, issue_id = ? WHERE id = ?',
    [title, targetValue, currentValue, unit, issueId, id],
  )
  const row = await get('SELECT * FROM key_results WHERE id = ?', [id])
  res.json(mapKeyResult(row))
}))

// DELETE /api/key-results/:id (Member+) — remove a key result
router.delete('/key-results/:id', requireRole('Member', 'Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM key_results WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

export default router
