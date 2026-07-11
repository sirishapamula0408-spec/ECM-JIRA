import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

// Allowed value sets (also used for validation)
export const INCIDENT_SEVERITIES = ['SEV1', 'SEV2', 'SEV3', 'SEV4']
export const INCIDENT_STATUSES = ['open', 'investigating', 'identified', 'monitoring', 'resolved']

/**
 * PURE HELPER — validate a severity value.
 * @returns {boolean} true when `severity` is one of the allowed values.
 */
export function isValidSeverity(severity) {
  return INCIDENT_SEVERITIES.includes(severity)
}

/**
 * PURE HELPER — validate a status value.
 * @returns {boolean} true when `status` is one of the allowed values.
 */
export function isValidStatus(status) {
  return INCIDENT_STATUSES.includes(status)
}

/**
 * PURE HELPER — pick the on-call shift covering `now`.
 * A shift covers `now` when starts_at <= now <= ends_at.
 * @param {Array<{starts_at:string|Date, ends_at:string|Date, user_email?:string}>} shifts
 * @param {Date|string|number} [now=new Date()]
 * @returns {object|null} the covering shift (or null when none matches)
 */
export function currentOnCall(shifts, now = new Date()) {
  if (!Array.isArray(shifts)) return null
  const t = new Date(now).getTime()
  if (Number.isNaN(t)) return null
  for (const shift of shifts) {
    const start = new Date(shift.starts_at).getTime()
    const end = new Date(shift.ends_at).getTime()
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    if (start <= t && t <= end) return shift
  }
  return null
}

/**
 * PURE HELPER — compute an incident's duration.
 * When `resolvedAt` is falsy the incident is still open and `now` is used.
 * @param {Date|string|number} startedAt
 * @param {Date|string|number|null} [resolvedAt=null]
 * @param {Date|string|number} [now=new Date()]
 * @returns {{ms:number, minutes:number, ongoing:boolean}}
 */
export function computeIncidentDuration(startedAt, resolvedAt = null, now = new Date()) {
  const start = new Date(startedAt).getTime()
  const ongoing = !resolvedAt
  const endTime = ongoing ? new Date(now).getTime() : new Date(resolvedAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(endTime)) {
    return { ms: 0, minutes: 0, ongoing }
  }
  const ms = Math.max(0, endTime - start)
  return { ms, minutes: Math.floor(ms / 60000), ongoing }
}

const router = Router()

/* ============================ Incidents ============================ */

// GET /api/incidents — list (optional ?status / ?severity)
router.get('/incidents', asyncHandler(async (req, res) => {
  const { status, severity } = req.query
  const clauses = []
  const params = []
  if (status) {
    if (!isValidStatus(status)) {
      res.status(400).json({ error: 'Invalid status' })
      return
    }
    clauses.push('status = ?')
    params.push(status)
  }
  if (severity) {
    if (!isValidSeverity(severity)) {
      res.status(400).json({ error: 'Invalid severity' })
      return
    }
    clauses.push('severity = ?')
    params.push(severity)
  }
  let sql = 'SELECT * FROM incidents'
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ')
  sql += ' ORDER BY started_at DESC'
  const rows = await all(sql, params)
  res.json(rows)
}))

// GET /api/incidents/:id — one incident with its timeline
router.get('/incidents/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const incident = await get('SELECT * FROM incidents WHERE id = ?', [id])
  if (!incident) {
    res.status(404).json({ error: 'Incident not found' })
    return
  }
  const timeline = await all(
    'SELECT * FROM incident_timeline WHERE incident_id = ? ORDER BY created_at ASC, id ASC',
    [id],
  )
  res.json({ ...incident, timeline })
}))

// POST /api/incidents — open a new incident (records a 'created' timeline entry)
router.post('/incidents', asyncHandler(async (req, res) => {
  const { title, description = '', severity = 'SEV3', status = 'open', issueId = null, commanderEmail = null } = req.body || {}
  if (!title?.trim()) {
    res.status(400).json({ error: 'title is required' })
    return
  }
  if (!isValidSeverity(severity)) {
    res.status(400).json({ error: 'Invalid severity' })
    return
  }
  if (!isValidStatus(status)) {
    res.status(400).json({ error: 'Invalid status' })
    return
  }
  const result = await run(
    'INSERT INTO incidents (title, description, severity, status, issue_id, commander_email) VALUES (?, ?, ?, ?, ?, ?)',
    [title.trim(), description, severity, status, issueId, commanderEmail || req.user?.email || null],
  )
  await run(
    'INSERT INTO incident_timeline (incident_id, kind, note, actor) VALUES (?, ?, ?, ?)',
    [result.lastID, 'created', `Incident opened (${severity})`, req.user?.email || null],
  )
  const incident = await get('SELECT * FROM incidents WHERE id = ?', [result.lastID])
  const timeline = await all('SELECT * FROM incident_timeline WHERE incident_id = ? ORDER BY created_at ASC, id ASC', [result.lastID])
  res.status(201).json({ ...incident, timeline })
}))

// PATCH /api/incidents/:id — update status/severity/etc
router.patch('/incidents/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM incidents WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Incident not found' })
    return
  }
  const { title, description, severity, status, commanderEmail } = req.body || {}
  const sets = []
  const params = []
  if (title !== undefined) { sets.push('title = ?'); params.push(title) }
  if (description !== undefined) { sets.push('description = ?'); params.push(description) }
  if (severity !== undefined) {
    if (!isValidSeverity(severity)) {
      res.status(400).json({ error: 'Invalid severity' })
      return
    }
    sets.push('severity = ?'); params.push(severity)
  }
  let resolving = false
  if (status !== undefined) {
    if (!isValidStatus(status)) {
      res.status(400).json({ error: 'Invalid status' })
      return
    }
    sets.push('status = ?'); params.push(status)
    if (status === 'resolved' && existing.status !== 'resolved') {
      resolving = true
      sets.push('resolved_at = NOW()')
    }
  }
  if (commanderEmail !== undefined) { sets.push('commander_email = ?'); params.push(commanderEmail) }

  if (!sets.length) {
    res.json(existing)
    return
  }
  params.push(id)
  await run(`UPDATE incidents SET ${sets.join(', ')} WHERE id = ?`, params)

  if (status !== undefined && status !== existing.status) {
    await run(
      'INSERT INTO incident_timeline (incident_id, kind, note, actor) VALUES (?, ?, ?, ?)',
      [id, resolving ? 'resolved' : 'status', `Status changed to ${status}`, req.user?.email || null],
    )
  } else if (severity !== undefined && severity !== existing.severity) {
    await run(
      'INSERT INTO incident_timeline (incident_id, kind, note, actor) VALUES (?, ?, ?, ?)',
      [id, 'severity', `Severity changed to ${severity}`, req.user?.email || null],
    )
  }
  const incident = await get('SELECT * FROM incidents WHERE id = ?', [id])
  res.json(incident)
}))

// POST /api/incidents/:id/timeline — add a note/update
router.post('/incidents/:id/timeline', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const incident = await get('SELECT id FROM incidents WHERE id = ?', [id])
  if (!incident) {
    res.status(404).json({ error: 'Incident not found' })
    return
  }
  const { note, kind = 'note' } = req.body || {}
  if (!note?.trim()) {
    res.status(400).json({ error: 'note is required' })
    return
  }
  const result = await run(
    'INSERT INTO incident_timeline (incident_id, kind, note, actor) VALUES (?, ?, ?, ?)',
    [id, kind, note.trim(), req.user?.email || null],
  )
  const entry = await get('SELECT * FROM incident_timeline WHERE id = ?', [result.lastID])
  res.status(201).json(entry)
}))

/* ============================ On-call ============================ */

// GET /api/oncall/current?scheduleId= — who is on call now
router.get('/oncall/current', asyncHandler(async (req, res) => {
  const scheduleId = req.query.scheduleId ? Number(req.query.scheduleId) : null
  let sql = 'SELECT * FROM oncall_shifts'
  const params = []
  if (scheduleId) {
    sql += ' WHERE schedule_id = ?'
    params.push(scheduleId)
  }
  sql += ' ORDER BY starts_at ASC'
  const shifts = await all(sql, params)
  const shift = currentOnCall(shifts, new Date())
  res.json({ onCall: shift ? shift.user_email : null, shift: shift || null })
}))

// GET /api/oncall/schedules — list schedules
router.get('/oncall/schedules', asyncHandler(async (_req, res) => {
  const rows = await all('SELECT * FROM oncall_schedules ORDER BY created_at DESC', [])
  res.json(rows)
}))

// GET /api/oncall/schedules/:id/shifts — list shifts for a schedule
router.get('/oncall/schedules/:id/shifts', asyncHandler(async (req, res) => {
  const rows = await all(
    'SELECT * FROM oncall_shifts WHERE schedule_id = ? ORDER BY starts_at ASC',
    [Number(req.params.id)],
  )
  res.json(rows)
}))

// POST /api/oncall/schedules — create a schedule (Admin)
router.post('/oncall/schedules', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { name, rotationType = 'weekly' } = req.body || {}
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const result = await run(
    'INSERT INTO oncall_schedules (name, rotation_type) VALUES (?, ?)',
    [name.trim(), rotationType],
  )
  const row = await get('SELECT * FROM oncall_schedules WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// DELETE /api/oncall/schedules/:id — delete a schedule (Admin)
router.delete('/oncall/schedules/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM oncall_schedules WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

// POST /api/oncall/schedules/:id/shifts — add a shift (Admin)
router.post('/oncall/schedules/:id/shifts', requireRole('Admin'), asyncHandler(async (req, res) => {
  const scheduleId = Number(req.params.id)
  const schedule = await get('SELECT id FROM oncall_schedules WHERE id = ?', [scheduleId])
  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found' })
    return
  }
  const { userEmail, startsAt, endsAt } = req.body || {}
  if (!userEmail?.trim() || !startsAt || !endsAt) {
    res.status(400).json({ error: 'userEmail, startsAt and endsAt are required' })
    return
  }
  const result = await run(
    'INSERT INTO oncall_shifts (schedule_id, user_email, starts_at, ends_at) VALUES (?, ?, ?, ?)',
    [scheduleId, userEmail.trim(), startsAt, endsAt],
  )
  const row = await get('SELECT * FROM oncall_shifts WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// DELETE /api/oncall/shifts/:id — remove a shift (Admin)
router.delete('/oncall/shifts/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM oncall_shifts WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

export default router
