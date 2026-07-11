import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { TRIGGER_TYPES, ACTION_TYPES } from '../services/automation.js'

const router = Router()

function mapRule(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    triggerType: row.trigger_type,
    conditionValue: row.condition_value || '',
    actionType: row.action_type,
    actionValue: row.action_value || '',
    enabled: row.enabled,
    scheduleIntervalMinutes: row.schedule_interval_minutes ?? null,
    lastRunAt: row.last_run_at ?? null,
    createdAt: row.created_at,
  }
}

// GET /api/projects/:projectId/automation-rules
router.get('/projects/:projectId/automation-rules', asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM automation_rules WHERE project_id = ? ORDER BY id DESC', [Number(req.params.projectId)])
  res.json(rows.map(mapRule))
}))

// POST /api/projects/:projectId/automation-rules (Admin)
router.post('/projects/:projectId/automation-rules', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const name = String(req.body?.name || '').trim()
  const triggerType = String(req.body?.triggerType || '').trim()
  const actionType = String(req.body?.actionType || '').trim()
  const conditionValue = String(req.body?.conditionValue || '').trim()
  const actionValue = String(req.body?.actionValue || '').trim()

  if (!name) { res.status(400).json({ error: 'Rule name is required' }); return }
  if (!TRIGGER_TYPES.includes(triggerType)) { res.status(400).json({ error: `triggerType must be one of: ${TRIGGER_TYPES.join(', ')}` }); return }
  if (!ACTION_TYPES.includes(actionType)) { res.status(400).json({ error: `actionType must be one of: ${ACTION_TYPES.join(', ')}` }); return }
  if ((actionType === 'assign' || actionType === 'transition' || actionType === 'comment') && !actionValue) {
    res.status(400).json({ error: 'actionValue is required for this action type' }); return
  }

  // JL-119: scheduled triggers require a positive interval in minutes.
  let scheduleIntervalMinutes = null
  if (triggerType === 'scheduled') {
    scheduleIntervalMinutes = Number(req.body?.scheduleIntervalMinutes)
    if (!Number.isFinite(scheduleIntervalMinutes) || scheduleIntervalMinutes <= 0) {
      res.status(400).json({ error: 'scheduleIntervalMinutes must be a positive number for scheduled triggers' }); return
    }
    scheduleIntervalMinutes = Math.floor(scheduleIntervalMinutes)
  }

  const created = await run(
    'INSERT INTO automation_rules (project_id, name, trigger_type, condition_value, action_type, action_value, schedule_interval_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [projectId, name, triggerType, conditionValue, actionType, actionValue, scheduleIntervalMinutes],
  )
  const row = await get('SELECT * FROM automation_rules WHERE id = ?', [created.lastID])
  res.status(201).json(mapRule(row))
}))

// PATCH /api/automation-rules/:id (Admin) — toggle enabled or edit fields
router.patch('/automation-rules/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM automation_rules WHERE id = ?', [id])
  if (!existing) { res.status(404).json({ error: 'Rule not found' }); return }

  const sets = []
  const params = []
  if (req.body?.enabled !== undefined) { sets.push('enabled = ?'); params.push(Boolean(req.body.enabled)) }
  if (req.body?.name !== undefined) { sets.push('name = ?'); params.push(String(req.body.name).trim()) }
  if (req.body?.conditionValue !== undefined) { sets.push('condition_value = ?'); params.push(String(req.body.conditionValue).trim()) }
  if (req.body?.actionValue !== undefined) { sets.push('action_value = ?'); params.push(String(req.body.actionValue).trim()) }
  if (req.body?.scheduleIntervalMinutes !== undefined) {
    const n = Number(req.body.scheduleIntervalMinutes)
    if (!Number.isFinite(n) || n <= 0) { res.status(400).json({ error: 'scheduleIntervalMinutes must be a positive number' }); return }
    sets.push('schedule_interval_minutes = ?'); params.push(Math.floor(n))
  }
  if (sets.length === 0) { res.json(mapRule(existing)); return }

  params.push(id)
  await run(`UPDATE automation_rules SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get('SELECT * FROM automation_rules WHERE id = ?', [id])
  res.json(mapRule(row))
}))

// DELETE /api/automation-rules/:id (Admin)
router.delete('/automation-rules/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM automation_rules WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

// GET /api/projects/:projectId/automation-logs — recent execution log
router.get('/projects/:projectId/automation-logs', asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT l.id, l.rule_id, l.issue_id, l.status, l.message, l.created_at, r.name AS rule_name
     FROM automation_logs l JOIN automation_rules r ON r.id = l.rule_id
     WHERE r.project_id = ? ORDER BY l.created_at DESC LIMIT 50`,
    [Number(req.params.projectId)],
  )
  res.json(rows)
}))

export default router
