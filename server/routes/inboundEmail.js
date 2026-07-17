import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { INBOUND_EMAIL_TOKEN } from '../config.js'
import { safeEqual } from '../utils/safeEqual.js'

/**
 * JL-148 — Inbound email → issue creation.
 *
 * A mail provider (SendGrid / Mailgun inbound-parse style) POSTs a parsed email
 * as JSON to `POST /api/inbound-email`. A new email creates an issue; a reply
 * whose subject carries an existing issue key appends a comment. Complements the
 * outbound SMTP delivery from JL-83.
 */

// Matches a JIRA-style issue key, e.g. PROJ-12, ABC1-3. First char a letter,
// then letters/digits, a hyphen, and a run of digits.
const ISSUE_KEY_RE = /[A-Z][A-Z0-9]+-\d+/

/**
 * Extract the first issue key found in a subject line, or null when absent.
 * Case-insensitive on input; the returned key is upper-cased for lookups.
 * PURE — no I/O; unit-testable.
 *
 * @param {string} subject
 * @returns {string|null}
 */
export function extractIssueKey(subject) {
  if (subject === undefined || subject === null) return null
  const match = String(subject).toUpperCase().match(ISSUE_KEY_RE)
  return match ? match[0] : null
}

// Pick the first present, non-blank value among candidate keys of a payload.
function firstField(payload, keys) {
  for (const key of keys) {
    const value = payload?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return ''
}

/**
 * Normalize a provider inbound-email payload into a stable shape, tolerant of
 * field-name variants across providers (SendGrid uses `from`/`to`/`text`,
 * Mailgun uses `sender`/`recipient`/`body-plain`/`stripped-text`, etc.).
 * PURE — no I/O; unit-testable. Missing fields become empty strings.
 *
 * @param {object} payload
 * @returns {{ from: string, to: string, subject: string, body: string }}
 */
export function parseInboundEmail(payload = {}) {
  const p = payload && typeof payload === 'object' ? payload : {}
  return {
    from: firstField(p, ['from', 'sender', 'From', 'from_email', 'fromAddress']),
    to: firstField(p, ['to', 'recipient', 'To', 'to_email', 'toAddress', 'envelope_to']),
    subject: firstField(p, ['subject', 'Subject', 'subj']),
    body: firstField(p, [
      'text',
      'body',
      'body-plain',
      'bodyPlain',
      'stripped-text',
      'strippedText',
      'html',
      'body-html',
      'Body',
    ]),
  }
}

// True when the shared token gate is satisfied (or disabled). When
// INBOUND_EMAIL_TOKEN is set, the request must present a matching token via the
// `x-inbound-token` header or a `token` field in the body; otherwise it is open.
function tokenAllowed(req) {
  if (!INBOUND_EMAIL_TOKEN) return true
  const provided = req.get('x-inbound-token') || req.body?.token
  // Constant-time compare (JL-184) so a timing side-channel can't reveal the token.
  return safeEqual(provided, INBOUND_EMAIL_TOKEN)
}

async function logInbound(fromAddress, subject, matchedKey, action) {
  try {
    await run(
      'INSERT INTO inbound_email_log (from_address, subject, matched_issue_key, action) VALUES (?, ?, ?, ?)',
      [fromAddress || null, subject || null, matchedKey || null, action || null],
    )
  } catch {
    // Auditing is best-effort — never fail the webhook on a log write.
  }
}

// ---------------------------------------------------------------------------
// Public webhook router (no JWT — gated by the shared INBOUND_EMAIL_TOKEN).
// ---------------------------------------------------------------------------
const webhookRouter = Router()

// POST /api/inbound-email — provider webhook.
webhookRouter.post('/', asyncHandler(async (req, res) => {
  if (!tokenAllowed(req)) {
    res.status(401).json({ error: 'Invalid or missing inbound email token' })
    return
  }

  const email = parseInboundEmail(req.body)
  if (!email.subject && !email.body) {
    res.status(400).json({ error: 'Email must include a subject or body' })
    return
  }

  const author = email.from || 'inbound-email'
  const issueKey = extractIssueKey(email.subject)

  // Reply path: an existing issue key in the subject → append a comment.
  if (issueKey) {
    const issue = await get('SELECT id, issue_key FROM issues WHERE issue_key = ?', [issueKey])
    if (issue) {
      const text = email.body || email.subject
      await run(
        'INSERT INTO comments (issue_id, author, text) VALUES (?, ?, ?)',
        [issue.id, author, text],
      )
      await logInbound(email.from, email.subject, issue.issue_key, 'commented')
      res.status(201).json({ action: 'commented', issueKey: issue.issue_key })
      return
    }
    // Key referenced an unknown issue — fall through and create a new one.
  }

  // Create path: map the recipient mailbox to a project and open an issue.
  const setting = email.to
    ? await get(
        'SELECT id, project_id, default_issue_type FROM inbound_email_settings WHERE LOWER(mailbox_address) = LOWER(?) AND enabled = TRUE ORDER BY id ASC LIMIT 1',
        [email.to],
      )
    : null

  if (!setting) {
    await logInbound(email.from, email.subject, null, 'ignored')
    res.status(404).json({ error: 'No inbound mailbox mapping found for recipient', to: email.to })
    return
  }

  let projectKey = 'PROJ'
  const resolvedProjectId = setting.project_id ?? null
  if (resolvedProjectId) {
    const project = await get('SELECT key FROM projects WHERE id = ?', [resolvedProjectId])
    if (project?.key) projectKey = project.key
  }

  // Allocate a monotonic issue key (mirrors issues.js key generation).
  let newKey
  if (resolvedProjectId) {
    const counterRow = await get(
      'UPDATE projects SET issue_counter = issue_counter + 1 WHERE id = ? RETURNING issue_counter',
      [resolvedProjectId],
    )
    newKey = `${projectKey}-${counterRow.issue_counter}`
  } else {
    const countRow = await get('SELECT COUNT(*) AS count FROM issues')
    newKey = `${projectKey}-${Number(countRow.count) + 1}`
  }

  const title = email.subject || '(no subject)'
  const description = email.body || email.subject || '(no body)'
  const issueType = setting.default_issue_type || 'Task'

  const created = await run(
    'INSERT INTO issues (issue_key, title, description, priority, assignee, status, issue_type, project_id, reporter, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
    [newKey, title, description, 'Medium', author, 'Backlog', issueType, resolvedProjectId, author],
  )

  await logInbound(email.from, email.subject, newKey, 'created')
  res.status(201).json({ action: 'created', issueKey: newKey, id: created.lastID })
}))

// ---------------------------------------------------------------------------
// Settings CRUD router (Admin-only; mounted behind the protect middleware).
// ---------------------------------------------------------------------------
const settingsRouter = Router()

// GET /api/inbound-email/settings — list mappings (+ recent processing log).
settingsRouter.get('/settings', requireRole('Admin'), asyncHandler(async (req, res) => {
  const settings = await all(
    `SELECT s.id, s.project_id, s.mailbox_address, s.default_issue_type, s.enabled, s.created_at,
            p.name AS project_name, p.key AS project_key
       FROM inbound_email_settings s
       LEFT JOIN projects p ON p.id = s.project_id
      ORDER BY s.id DESC`,
  )
  const log = await all(
    'SELECT id, from_address, subject, matched_issue_key, action, created_at FROM inbound_email_log ORDER BY id DESC LIMIT 50',
  )
  res.json({ settings, log })
}))

// POST /api/inbound-email/settings — create/map a mailbox to a project.
settingsRouter.post('/settings', requireRole('Admin'), asyncHandler(async (req, res) => {
  const mailbox = String(req.body?.mailboxAddress || req.body?.mailbox_address || '').trim()
  if (!mailbox) {
    res.status(400).json({ error: 'mailboxAddress is required' })
    return
  }

  const projectId =
    req.body?.projectId === undefined || req.body?.projectId === null || req.body?.projectId === ''
      ? null
      : Number(req.body.projectId)
  if (projectId !== null && !Number.isInteger(projectId)) {
    res.status(400).json({ error: 'projectId must be an integer' })
    return
  }
  if (projectId !== null) {
    const project = await get('SELECT id FROM projects WHERE id = ?', [projectId])
    if (!project) {
      res.status(400).json({ error: 'Project not found' })
      return
    }
  }

  const defaultIssueType = String(req.body?.defaultIssueType || 'Task').trim() || 'Task'
  const enabled = req.body?.enabled === undefined ? true : Boolean(req.body.enabled)

  const created = await run(
    'INSERT INTO inbound_email_settings (project_id, mailbox_address, default_issue_type, enabled) VALUES (?, ?, ?, ?)',
    [projectId, mailbox, defaultIssueType, enabled],
  )
  const row = await get(
    'SELECT id, project_id, mailbox_address, default_issue_type, enabled, created_at FROM inbound_email_settings WHERE id = ?',
    [created.lastID],
  )
  res.status(201).json(row)
}))

// DELETE /api/inbound-email/settings/:id — remove a mapping.
settingsRouter.delete('/settings/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid id' })
    return
  }
  const existing = await get('SELECT id FROM inbound_email_settings WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Setting not found' })
    return
  }
  await run('DELETE FROM inbound_email_settings WHERE id = ?', [id])
  res.json({ success: true, id })
}))

export default webhookRouter
export { settingsRouter }
