import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

// GET /api/webhooks — list webhooks
router.get('/', asyncHandler(async (req, res) => {
  const projectId = req.query.projectId ? Number(req.query.projectId) : null
  let sql = 'SELECT id, name, url, events, project_id, is_active, created_by, created_at, updated_at FROM webhooks'
  const params = []
  if (projectId) {
    sql += ' WHERE project_id = ?'
    params.push(projectId)
  }
  sql += ' ORDER BY created_at DESC'
  const rows = await all(sql, params)
  res.json(rows)
}))

// GET /api/webhooks/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM webhooks WHERE id = ?', [Number(req.params.id)])
  if (!row) {
    res.status(404).json({ error: 'Webhook not found' })
    return
  }
  res.json(row)
}))

// POST /api/webhooks — create webhook (Admin only)
router.post('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { name, url, secret = '', events = [], projectId = null } = req.body
  if (!name?.trim() || !url?.trim()) {
    res.status(400).json({ error: 'name and url are required' })
    return
  }
  const result = await run(
    'INSERT INTO webhooks (name, url, secret, events, project_id, created_by) VALUES (?, ?, ?, ?::jsonb, ?, ?)',
    [name.trim(), url.trim(), secret, JSON.stringify(events), projectId, req.user.email],
  )
  const row = await get('SELECT * FROM webhooks WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// PATCH /api/webhooks/:id — update webhook
router.patch('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM webhooks WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Webhook not found' })
    return
  }

  const { name, url, secret, events, isActive } = req.body
  const sets = []
  const params = []

  if (name !== undefined) { sets.push('name = ?'); params.push(name.trim()) }
  if (url !== undefined) { sets.push('url = ?'); params.push(url.trim()) }
  if (secret !== undefined) { sets.push('secret = ?'); params.push(secret) }
  if (events !== undefined) { sets.push('events = ?::jsonb'); params.push(JSON.stringify(events)) }
  if (isActive !== undefined) { sets.push('is_active = ?'); params.push(isActive) }

  if (sets.length === 0) {
    res.json(existing)
    return
  }

  sets.push('updated_at = NOW()')
  params.push(id)
  await run(`UPDATE webhooks SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get('SELECT * FROM webhooks WHERE id = ?', [id])
  res.json(row)
}))

// DELETE /api/webhooks/:id
router.delete('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM webhooks WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

// POST /api/webhooks/:id/test — test a webhook
router.post('/:id/test', requireRole('Admin'), asyncHandler(async (req, res) => {
  const webhook = await get('SELECT * FROM webhooks WHERE id = ?', [Number(req.params.id)])
  if (!webhook) {
    res.status(404).json({ error: 'Webhook not found' })
    return
  }

  const testPayload = {
    event: 'test',
    timestamp: new Date().toISOString(),
    data: { message: 'This is a test webhook delivery' },
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const body = await response.text().catch(() => '')
    await run(
      'INSERT INTO webhook_logs (webhook_id, event, payload, response_status, response_body, success) VALUES (?, ?, ?::jsonb, ?, ?, ?)',
      [webhook.id, 'test', JSON.stringify(testPayload), response.status, body.slice(0, 2000), response.ok],
    )
    res.json({ success: response.ok, status: response.status })
  } catch (err) {
    await run(
      'INSERT INTO webhook_logs (webhook_id, event, payload, response_status, response_body, success) VALUES (?, ?, ?::jsonb, ?, ?, ?)',
      [webhook.id, 'test', JSON.stringify(testPayload), 0, err.message, false],
    )
    res.json({ success: false, error: err.message })
  }
}))

// GET /api/webhooks/:id/logs — get webhook delivery logs
router.get('/:id/logs', asyncHandler(async (req, res) => {
  const rows = await all(
    'SELECT id, event, payload, response_status, response_body, success, created_at FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50',
    [Number(req.params.id)],
  )
  res.json(rows)
}))

export default router

/**
 * Fire webhooks for a given event. Call from other routes.
 */
export async function fireWebhooks(event, data, projectId = null) {
  try {
    let sql = 'SELECT id, url, secret FROM webhooks WHERE is_active = TRUE'
    const params = []
    if (projectId) {
      sql += ' AND (project_id = ? OR project_id IS NULL)'
      params.push(projectId)
    }
    const hooks = await all(sql, params)

    for (const hook of hooks) {
      const events = typeof hook.events === 'string' ? JSON.parse(hook.events) : (hook.events || [])
      if (events.length > 0 && !events.includes(event) && !events.includes('*')) continue

      const payload = { event, timestamp: new Date().toISOString(), data }
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        const response = await fetch(hook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        clearTimeout(timeout)
        const body = await response.text().catch(() => '')
        await run(
          'INSERT INTO webhook_logs (webhook_id, event, payload, response_status, response_body, success) VALUES (?, ?, ?::jsonb, ?, ?, ?)',
          [hook.id, event, JSON.stringify(payload), response.status, body.slice(0, 2000), response.ok],
        )
      } catch (err) {
        await run(
          'INSERT INTO webhook_logs (webhook_id, event, payload, response_status, response_body, success) VALUES (?, ?, ?::jsonb, ?, ?, ?)',
          [hook.id, event, JSON.stringify(payload), 0, err.message, false],
        )
      }
    }
  } catch {
    // Don't let webhook errors break the main flow
  }
}
