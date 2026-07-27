import { Router } from 'express'
import crypto from 'node:crypto'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { safeAppendAudit } from '../services/auditLog.js'
import { maxLengthError } from '../utils/validation.js'
import { EVENT_TYPES } from '../services/events.js'
import { isWebhookBlockPrivate } from '../config.js'

// JL-236: cap the target URL length (defense-in-depth against absurd inputs).
const WEBHOOK_URL_MAX = 2000

/**
 * JL-236: True when `host` is a loopback / link-local / private IP literal or
 * `localhost`. Pure string/IP-literal inspection — NO live DNS resolution — so
 * it stays dependency-free and side-effect-free. UNIT-TESTABLE.
 *
 * Covers: localhost (and *.localhost), IPv4 127.0.0.0/8, 10.0.0.0/8,
 * 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 (link-local), 0.0.0.0/8, and
 * IPv6 ::1 / :: / unique-local (fc00::/7) / link-local (fe80::/10).
 *
 * @param {string} host  URL hostname (as from `new URL(url).hostname`)
 * @returns {boolean}
 */
export function isPrivateHost(host) {
  const bare = String(host || '').toLowerCase().trim().replace(/^\[/, '').replace(/\]$/, '')
  if (!bare) return true
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true
  // IPv6 loopback / unspecified / unique-local / link-local
  if (bare === '::1' || bare === '::') return true
  if (/^f[cd][0-9a-f]{2}:/.test(bare)) return true
  if (/^fe[89ab][0-9a-f]:/.test(bare)) return true
  // IPv4 literals
  const m = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 127) return true                         // loopback 127.0.0.0/8
    if (a === 10) return true                           // private 10.0.0.0/8
    if (a === 192 && b === 168) return true             // private 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true    // private 172.16.0.0/12
    if (a === 169 && b === 254) return true             // link-local 169.254.0.0/16
    if (a === 0) return true                            // "this" network 0.0.0.0/8
  }
  return false
}

/**
 * JL-236: Validate a webhook target URL. Returns a 400-ready error string, or
 * `null` when the URL is acceptable. Rejects non-http(s) schemes and (when
 * `blockPrivate`) loopback/link-local/private hosts; enforces the length cap.
 *
 * @param {string} url  already-trimmed candidate URL
 * @param {boolean} [blockPrivate=false]
 * @returns {string|null}
 */
export function validateWebhookUrl(url, blockPrivate = false) {
  const lenErr = maxLengthError('url', url, WEBHOOK_URL_MAX)
  if (lenErr) return lenErr
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return 'url must be a valid http(s) URL'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'url must use the http or https scheme'
  }
  if (blockPrivate && isPrivateHost(parsed.hostname)) {
    return 'url host is not allowed (loopback, link-local and private addresses are blocked)'
  }
  return null
}

/**
 * JL-236: Validate a webhook `events` array against the emitted-event catalog
 * (server/services/events.js). The `*` wildcard (subscribe-to-all) is allowed.
 * Returns a 400-ready error string listing the allowed events, or `null`.
 *
 * @param {*} events
 * @returns {string|null}
 */
export function validateWebhookEvents(events) {
  if (events === undefined || events === null) return null
  if (!Array.isArray(events)) return 'events must be an array'
  const allowed = new Set([...EVENT_TYPES, '*'])
  const unknown = events.filter((e) => !allowed.has(e))
  if (unknown.length > 0) {
    return `Unknown event(s): ${unknown.join(', ')}. Allowed events: ${[...EVENT_TYPES, '*'].join(', ')}`
  }
  return null
}

/** Compute HMAC-SHA256 signature for webhook payload verification */
function signPayload(payload, secret) {
  if (!secret) return ''
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
}

/** Helper to log a webhook delivery */
async function logDelivery(webhookId, event, payload, status, body, success) {
  await run(
    'INSERT INTO webhook_logs (webhook_id, event, payload, response_status, response_body, success) VALUES (?, ?, ?::jsonb, ?, ?, ?)',
    [webhookId, event, JSON.stringify(payload), status, String(body).slice(0, 2000), success],
  )
}

/**
 * JL-150: Pure helper — reconstruct the payload + headers to re-send from a
 * stored webhook_logs row. Parses the JSONB payload (string or object) and,
 * when a secret is supplied, adds the HMAC signature header. UNIT-TESTABLE.
 *
 * @param {{event:string, payload:any}} logRow  A webhook_logs row.
 * @param {string} [secret]  The parent webhook's secret (for signing).
 * @returns {{event:string, payload:object, headers:object}}
 */
export function buildReplayPayload(logRow, secret = '') {
  const payload = typeof logRow.payload === 'string'
    ? JSON.parse(logRow.payload || '{}')
    : (logRow.payload || {})
  const headers = { 'Content-Type': 'application/json' }
  const signature = signPayload(payload, secret)
  if (signature) headers['X-Hub-Signature-256'] = `sha256=${signature}`
  return { event: logRow.event, payload, headers }
}

/** Pre-built Slack message template */
function formatSlackPayload(event, data) {
  return {
    text: `*[JIRA Lite]* ${event}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${event}*\n${JSON.stringify(data).slice(0, 500)}` } },
    ],
  }
}

/** Pre-built Discord message template */
function formatDiscordPayload(event, data) {
  return {
    content: `**[JIRA Lite]** ${event}`,
    embeds: [
      { title: event, description: JSON.stringify(data).slice(0, 500), color: 0x0052cc },
    ],
  }
}

/** Pre-built Teams message template */
function formatTeamsPayload(event, data) {
  return {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    summary: `JIRA Lite: ${event}`,
    themeColor: '0052CC',
    title: `JIRA Lite: ${event}`,
    text: JSON.stringify(data).slice(0, 500),
  }
}

const MAX_RETRIES = 3

// JL-184: columns safe to return to clients — the `secret` is NEVER included so
// create/update responses match the list/GET behaviour and don't echo secrets.
const PUBLIC_WEBHOOK_COLUMNS =
  'id, name, url, events, project_id, is_active, created_by, created_at, updated_at'

const router = Router()

// GET /api/webhooks — list webhooks (Admin only, exclude secrets)
router.get('/', requireRole('Admin'), asyncHandler(async (req, res) => {
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

// GET /api/webhooks/deliveries — searchable/filterable delivery console (Admin only)
// Filters: ?webhookId, ?status=success|failed, ?event, ?limit, ?offset
// NOTE: declared before '/:id' so 'deliveries' is not swallowed as an :id.
router.get('/deliveries', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { webhookId, status, event } = req.query
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
  const offset = Math.max(Number(req.query.offset) || 0, 0)

  const conditions = []
  const params = []
  if (webhookId) { conditions.push('l.webhook_id = ?'); params.push(Number(webhookId)) }
  if (status === 'success') { conditions.push('l.success = TRUE') }
  else if (status === 'failed') { conditions.push('l.success = FALSE') }
  if (event) { conditions.push('l.event = ?'); params.push(event) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const sql = `SELECT l.id, l.webhook_id, l.event, l.response_status, l.success, l.created_at,
      w.name AS webhook_name, w.url AS webhook_url
    FROM webhook_logs l
    LEFT JOIN webhooks w ON w.id = l.webhook_id
    ${where}
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?`
  params.push(limit, offset)
  const rows = await all(sql, params)
  res.json(rows)
}))

// GET /api/webhooks/deliveries/:id — one delivery's detail (request payload + response)
router.get('/deliveries/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const row = await get(
    `SELECT l.id, l.webhook_id, l.event, l.payload, l.response_status, l.response_body,
        l.success, l.created_at, w.name AS webhook_name, w.url AS webhook_url
      FROM webhook_logs l
      LEFT JOIN webhooks w ON w.id = l.webhook_id
      WHERE l.id = ?`,
    [Number(req.params.id)],
  )
  if (!row) {
    res.status(404).json({ error: 'Delivery not found' })
    return
  }
  res.json(row)
}))

// POST /api/webhooks/deliveries/:id/replay — re-send a stored delivery (Admin only)
router.post('/deliveries/:id/replay', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid delivery id' })
    return
  }

  const log = await get('SELECT id, webhook_id, event, payload FROM webhook_logs WHERE id = ?', [id])
  if (!log) {
    res.status(404).json({ error: 'Delivery not found' })
    return
  }

  const webhook = await get('SELECT * FROM webhooks WHERE id = ?', [log.webhook_id])
  if (!webhook) {
    res.status(404).json({ error: 'Webhook not found' })
    return
  }

  const { event, payload, headers } = buildReplayPayload(log, webhook.secret)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const body = await response.text().catch(() => '')
    await logDelivery(webhook.id, event, payload, response.status, body, response.ok)
    res.json({ success: response.ok, status: response.status, replayedFrom: id })
  } catch (err) {
    await logDelivery(webhook.id, event, payload, 0, err.message, false)
    res.json({ success: false, error: err.message, replayedFrom: id })
  }
}))

// GET /api/webhooks/:id (Admin only, exclude secret)
router.get('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const row = await get('SELECT id, name, url, events, project_id, is_active, created_by, created_at, updated_at FROM webhooks WHERE id = ?', [Number(req.params.id)])
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
  // JL-236: SSRF hardening — validate scheme/host/length + event-name catalog.
  const trimmedUrl = url.trim()
  const urlErr = validateWebhookUrl(trimmedUrl, isWebhookBlockPrivate())
  if (urlErr) {
    res.status(400).json({ error: urlErr })
    return
  }
  const eventsErr = validateWebhookEvents(events)
  if (eventsErr) {
    res.status(400).json({ error: eventsErr })
    return
  }
  const result = await run(
    'INSERT INTO webhooks (name, url, secret, events, project_id, created_by) VALUES (?, ?, ?, ?::jsonb, ?, ?)',
    [name.trim(), trimmedUrl, secret, JSON.stringify(events), projectId, req.user.email],
  )
  const row = await get(`SELECT ${PUBLIC_WEBHOOK_COLUMNS} FROM webhooks WHERE id = ?`, [result.lastID])
  // JL-132: record webhook creation in the tamper-evident audit log.
  safeAppendAudit({ actor: req.user.email, action: 'webhook.create', target: `webhook:${row.id}`, metadata: { name: row.name, url: row.url } })
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
  if (url !== undefined) {
    // JL-236: SSRF hardening — validate scheme/host/length on update too.
    const trimmedUrl = url.trim()
    const urlErr = validateWebhookUrl(trimmedUrl, isWebhookBlockPrivate())
    if (urlErr) {
      res.status(400).json({ error: urlErr })
      return
    }
    sets.push('url = ?'); params.push(trimmedUrl)
  }
  if (secret !== undefined) { sets.push('secret = ?'); params.push(secret) }
  if (events !== undefined) {
    // JL-236: validate event names against the emitted-event catalog.
    const eventsErr = validateWebhookEvents(events)
    if (eventsErr) {
      res.status(400).json({ error: eventsErr })
      return
    }
    sets.push('events = ?::jsonb'); params.push(JSON.stringify(events))
  }
  if (isActive !== undefined) { sets.push('is_active = ?'); params.push(isActive) }

  if (sets.length === 0) {
    // JL-184: re-read without the secret rather than echoing `existing` (SELECT *).
    const unchanged = await get(`SELECT ${PUBLIC_WEBHOOK_COLUMNS} FROM webhooks WHERE id = ?`, [id])
    res.json(unchanged)
    return
  }

  sets.push('updated_at = NOW()')
  params.push(id)
  await run(`UPDATE webhooks SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get(`SELECT ${PUBLIC_WEBHOOK_COLUMNS} FROM webhooks WHERE id = ?`, [id])
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

  const signature = signPayload(testPayload, webhook.secret)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const headers = { 'Content-Type': 'application/json' }
    if (signature) headers['X-Hub-Signature-256'] = `sha256=${signature}`
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(testPayload),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const body = await response.text().catch(() => '')
    await logDelivery(webhook.id, 'test', testPayload, response.status, body, response.ok)
    res.json({ success: response.ok, status: response.status })
  } catch (err) {
    await logDelivery(webhook.id, 'test', testPayload, 0, err.message, false)
    res.json({ success: false, error: err.message })
  }
}))

// GET /api/webhooks/:id/logs — get webhook delivery logs (Admin only)
router.get('/:id/logs', requireRole('Admin'), asyncHandler(async (req, res) => {
  const rows = await all(
    'SELECT id, event, payload, response_status, response_body, success, created_at FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50',
    [Number(req.params.id)],
  )
  res.json(rows)
}))

// POST /api/webhooks/logs/:logId/replay — re-send a past delivery (Admin only)
router.post('/logs/:logId/replay', requireRole('Admin'), asyncHandler(async (req, res) => {
  const logId = Number(req.params.logId)
  if (!Number.isInteger(logId)) {
    res.status(400).json({ error: 'Invalid log id' })
    return
  }

  const log = await get('SELECT id, webhook_id, event, payload FROM webhook_logs WHERE id = ?', [logId])
  if (!log) {
    res.status(404).json({ error: 'Delivery log not found' })
    return
  }

  const webhook = await get('SELECT * FROM webhooks WHERE id = ?', [log.webhook_id])
  if (!webhook) {
    res.status(404).json({ error: 'Webhook not found' })
    return
  }

  const payload = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload
  const signature = signPayload(payload, webhook.secret)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const headers = { 'Content-Type': 'application/json' }
    if (signature) headers['X-Hub-Signature-256'] = `sha256=${signature}`
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const body = await response.text().catch(() => '')
    await logDelivery(webhook.id, log.event, payload, response.status, body, response.ok)
    res.json({ success: response.ok, status: response.status, replayedFrom: logId })
  } catch (err) {
    await logDelivery(webhook.id, log.event, payload, 0, err.message, false)
    res.json({ success: false, error: err.message, replayedFrom: logId })
  }
}))

export default router

/**
 * Fire webhooks for a given event with HMAC signing and retry logic.
 */
export async function fireWebhooks(event, data, projectId = null) {
  try {
    let sql = 'SELECT id, url, secret, name, events FROM webhooks WHERE is_active = TRUE'
    const params = []
    if (projectId) {
      sql += ' AND (project_id = ? OR project_id IS NULL)'
      params.push(projectId)
    }
    const hooks = await all(sql, params)

    for (const hook of hooks) {
      const events = typeof hook.events === 'string' ? JSON.parse(hook.events) : (hook.events || [])
      if (events.length > 0 && !events.includes(event) && !events.includes('*')) continue

      // Use Slack/Teams templates based on webhook name
      const hookName = (hook.name || '').toLowerCase()
      let payload
      if (hookName.includes('slack')) {
        payload = formatSlackPayload(event, data)
      } else if (hookName.includes('teams')) {
        payload = formatTeamsPayload(event, data)
      } else if (hookName.includes('discord')) {
        payload = formatDiscordPayload(event, data)
      } else {
        payload = { event, timestamp: new Date().toISOString(), data }
      }

      const signature = signPayload(payload, hook.secret)
      const headers = { 'Content-Type': 'application/json' }
      if (signature) headers['X-Hub-Signature-256'] = `sha256=${signature}`

      // Retry with exponential backoff
      let success = false
      for (let attempt = 0; attempt < MAX_RETRIES && !success; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)))
        }
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10000)
          const response = await fetch(hook.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
          })
          clearTimeout(timeout)
          const body = await response.text().catch(() => '')
          await logDelivery(hook.id, event, payload, response.status, body, response.ok)
          success = response.ok
        } catch (err) {
          if (attempt === MAX_RETRIES - 1) {
            await logDelivery(hook.id, event, payload, 0, err.message, false)
          }
        }
      }
    }
  } catch {
    // Don't let webhook errors break the main flow
  }
}
