import { Router } from 'express'
import { get, run, all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

function mapSprint(row) {
  return {
    id: row.id,
    name: row.name,
    dateRange: row.date_range,
    isStarted: Boolean(row.is_started),
  }
}

router.get('/', asyncHandler(async (_req, res) => {
  const rows = await all('SELECT id, name, date_range, is_started FROM sprints ORDER BY id ASC')
  res.json(rows.map(mapSprint))
}))

router.post('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { name, dateRange } = req.body || {}

  const count = await get('SELECT COUNT(*) AS count FROM sprints')
  const fallbackName = `SCRUM Sprint ${count.count + 1}`
  const nextName = String(name || '').trim() || fallbackName
  const nextDateRange = String(dateRange || '').trim() || 'Upcoming'

  const created = await run('INSERT INTO sprints (name, date_range, is_started) VALUES (?, ?, ?)', [
    nextName,
    nextDateRange,
    0,
  ])

  const row = await get('SELECT id, name, date_range, is_started FROM sprints WHERE id = ?', [created.lastID])
  res.status(201).json(mapSprint(row))
}))

router.patch('/:id/start', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  const update = await run('UPDATE sprints SET is_started = 1 WHERE id = ?', [id])
  if (update.changes === 0) {
    res.status(404).json({ error: 'Sprint not found' })
    return
  }

  const row = await get('SELECT id, name, date_range, is_started FROM sprints WHERE id = ?', [id])
  res.json(mapSprint(row))
}))

router.patch('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const { name, dateRange } = req.body || {}

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  const nextName = String(name || '').trim()
  const nextDateRange = String(dateRange || '').trim()
  if (!nextName) {
    res.status(400).json({ error: 'Sprint name is required' })
    return
  }

  const update = await run('UPDATE sprints SET name = ?, date_range = ? WHERE id = ?', [nextName, nextDateRange || 'Upcoming', id])
  if (update.changes === 0) {
    res.status(404).json({ error: 'Sprint not found' })
    return
  }

  const row = await get('SELECT id, name, date_range, is_started FROM sprints WHERE id = ?', [id])
  res.json(mapSprint(row))
}))

router.patch('/:id/complete', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  const sprint = await get('SELECT id, name, date_range, is_started FROM sprints WHERE id = ?', [id])
  if (!sprint) {
    res.status(404).json({ error: 'Sprint not found' })
    return
  }

  await run("UPDATE issues SET status = 'Backlog', sprint_id = NULL WHERE sprint_id = ? AND status != 'Done'", [id])
  await run('UPDATE sprints SET is_started = 0 WHERE id = ?', [id])

  const row = await get('SELECT id, name, date_range, is_started FROM sprints WHERE id = ?', [id])
  res.json(mapSprint(row))
}))

router.delete('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  const sprint = await get('SELECT id, name, date_range, is_started FROM sprints WHERE id = ?', [id])
  if (!sprint) {
    res.status(404).json({ error: 'Sprint not found' })
    return
  }

  await run("UPDATE issues SET status = 'Backlog', sprint_id = NULL WHERE sprint_id = ?", [id])
  await run('DELETE FROM sprints WHERE id = ?', [id])
  res.json({ ok: true, deleted: mapSprint(sprint) })
}))

export default router
