import crypto from 'node:crypto'
import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { parseTimeToMinutes } from './worklogs.js'
import { safeEqual } from '../utils/safeEqual.js'

const router = Router()

// PR states a webhook may set on a git_links pull_request row.
const PR_STATES = ['open', 'merged', 'closed']

export const GIT_LINK_TYPES = ['branch', 'commit', 'pull_request']

// Valid statuses a smart-commit transition may target (mirrors constants.js).
const SMART_STATUSES = ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done']
// Map a smart-commit status token (#done, #in-progress, ...) to a canonical status.
const STATUS_BY_TOKEN = SMART_STATUSES.reduce((acc, s) => {
  acc[s.toLowerCase().replace(/\s+/g, '-')] = s
  return acc
}, {})

/**
 * Extract JIRA-style issue keys (e.g. TP-12, ABC-9) from arbitrary text.
 * Exported for unit testing. Returns unique keys in first-seen order.
 * Ignores lowercase / non-key tokens; keys are always upper-case letters
 * followed by a hyphen and digits.
 */
export function parseIssueKeys(text) {
  if (!text || typeof text !== 'string') return []
  const matches = text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || []
  return [...new Set(matches)]
}

/**
 * Parse smart-commit directives from a commit message.
 * Supported (kept minimal & safe):
 *   #comment <text>     -> add a comment
 *   #time <e.g. 1h>     -> acknowledged only
 *   #<status>           -> transition (e.g. #done, #in-progress)
 * Returns { comment, time, transition } (any may be null).
 */
export function parseSmartCommands(message) {
  const result = { comment: null, time: null, transition: null }
  if (!message || typeof message !== 'string') return result

  // #comment captures text up to the next directive or end of string.
  const commentMatch = message.match(/#comment\s+([^#]+)/i)
  if (commentMatch) result.comment = commentMatch[1].trim()

  const timeMatch = message.match(/#time\s+([^\s#]+)/i)
  if (timeMatch) result.time = timeMatch[1].trim()

  // Scan remaining `#token` directives for a status match.
  const tokens = message.match(/#([a-zA-Z][a-zA-Z-]*)/g) || []
  for (const raw of tokens) {
    const token = raw.slice(1).toLowerCase()
    if (token === 'comment' || token === 'time') continue
    if (STATUS_BY_TOKEN[token]) {
      result.transition = STATUS_BY_TOKEN[token]
      break
    }
  }
  return result
}

/**
 * JL-147: Extract issue keys from a branch name or PR title.
 * Thin alias over parseIssueKeys so callers reading provider payloads have an
 * intent-revealing name. Handles slashes/underscores in branch refs since the
 * key regex is word-boundary based (e.g. feature/JL-42_login → ['JL-42']).
 */
export function extractIssueKeysFromRef(branchOrTitle) {
  if (!branchOrTitle || typeof branchOrTitle !== 'string') return []
  // Branch refs use `/` and `_` as separators (feature/JL-42_login) which
  // suppress the \b boundary after the key's digits. Normalize them to spaces
  // so parseIssueKeys' word-boundary regex still finds the key.
  return parseIssueKeys(branchOrTitle.replace(/[/_]+/g, ' '))
}

/**
 * JL-147: Parse a single commit message into a smart-commit descriptor.
 * Returns { issueKey, time, comment, transition } where issueKey is the FIRST
 * referenced key (or null) and the command fields reuse parseSmartCommands.
 * Pure — unit-testable without a DB. A plain message yields all-null commands.
 */
export function parseSmartCommit(message) {
  const keys = parseIssueKeys(message)
  const commands = parseSmartCommands(message)
  let transition = commands.transition
  // Also support the explicit `#transition <Status>` form (e.g. "#transition Done",
  // "#transition In Progress") in addition to the shorthand `#done` tokens.
  if (!transition && typeof message === 'string') {
    const m = message.match(/#transition\s+([A-Za-z][A-Za-z ]*?)(?=\s+#|$)/i)
    if (m) {
      const wanted = m[1].trim().toLowerCase()
      transition = SMART_STATUSES.find((s) => s.toLowerCase() === wanted) || null
    }
  }
  return {
    issueKey: keys[0] || null,
    time: commands.time,
    comment: commands.comment,
    transition,
  }
}

/**
 * JL-147: Apply a parsed smart-commit via injected action functions.
 * `actions` provides { addWorklog, addComment, transitionIssue } — each is
 * invoked only when the corresponding command is present. Kept dependency-free
 * and LOOP-SAFE: the caller wires the actions straight to persistence, never
 * back through an event/automation engine. Returns the list of applied action
 * names for logging/assertion. Missing action fns are skipped gracefully.
 */
export async function applySmartCommit(parsed, actions = {}) {
  const applied = []
  if (!parsed) return applied
  const { addWorklog, addComment, transitionIssue } = actions
  if (parsed.time && typeof addWorklog === 'function') {
    await addWorklog(parsed.time)
    applied.push('worklog')
  }
  if (parsed.comment && typeof addComment === 'function') {
    await addComment(parsed.comment)
    applied.push('comment')
  }
  if (parsed.transition && typeof transitionIssue === 'function') {
    await transitionIssue(parsed.transition)
    applied.push('transition')
  }
  return applied
}

// GET /api/issues/:issueId/git-links — list all git links for an issue
router.get('/issues/:issueId/git-links', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const rows = await all(
    `SELECT id, issue_id, link_type, ref, url, title, author, created_at
     FROM git_links WHERE issue_id = ? ORDER BY created_at DESC`,
    [issueId],
  )
  res.json(rows)
}))

// POST /api/issues/:issueId/git-links — manually add a git link
router.post('/issues/:issueId/git-links', requireRole('Member'), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const linkType = String(req.body?.linkType || '').trim()
  const ref = String(req.body?.ref || '').trim()
  const url = String(req.body?.url || '').trim()
  const title = String(req.body?.title || '').trim()
  const author = String(req.body?.author || '').trim()

  if (!GIT_LINK_TYPES.includes(linkType)) {
    res.status(400).json({ error: `linkType must be one of: ${GIT_LINK_TYPES.join(', ')}` })
    return
  }
  if (!ref) {
    res.status(400).json({ error: 'ref is required' })
    return
  }
  const issue = await get('SELECT id FROM issues WHERE id = ?', [issueId])
  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return }

  const created = await run(
    `INSERT INTO git_links (issue_id, link_type, ref, url, title, author)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [issueId, linkType, ref, url, title, author || req.user?.email || ''],
  )
  const row = await get(
    `SELECT id, issue_id, link_type, ref, url, title, author, created_at
     FROM git_links WHERE id = ?`,
    [created.lastID],
  )
  res.status(201).json(row)
}))

// DELETE /api/git-links/:id — remove a git link
router.delete('/git-links/:id', requireRole('Member'), asyncHandler(async (req, res) => {
  await run('DELETE FROM git_links WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

// POST /api/git/ingest — accept a commit / PR payload and create links for
// every referenced existing issue, plus apply smart-commit directives.
router.post('/git/ingest', requireRole('Member'), asyncHandler(async (req, res) => {
  const type = String(req.body?.type || '').trim()
  const ref = String(req.body?.ref || '').trim()
  const url = String(req.body?.url || '').trim()
  const title = String(req.body?.title || '').trim()
  const author = String(req.body?.author || '').trim()
  const message = String(req.body?.message || '')

  if (!GIT_LINK_TYPES.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${GIT_LINK_TYPES.join(', ')}` })
    return
  }

  // Parse issue keys from message + ref + title.
  const keys = parseIssueKeys(`${message} ${ref} ${title}`)
  if (keys.length === 0) {
    res.status(200).json({ links: [], smartCommit: null, referencedKeys: [], message: 'No issue keys found' })
    return
  }

  const smart = parseSmartCommands(message)
  const links = []
  const appliedTo = []

  for (const key of keys) {
    const issue = await get('SELECT id, issue_key, status FROM issues WHERE issue_key = ?', [key])
    if (!issue) continue // only link existing issues

    const created = await run(
      `INSERT INTO git_links (issue_id, link_type, ref, url, title, author)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [issue.id, type, ref || key, url, title, author],
    )
    links.push({ id: created.lastID, issueId: issue.id, issueKey: key, linkType: type, ref: ref || key })

    // Smart-commit actions — apply directly to the DB (no engine re-invocation).
    if (smart.comment) {
      await run(
        'INSERT INTO comments (issue_id, author, text) VALUES (?, ?, ?)',
        [issue.id, author || 'git', smart.comment],
      )
    }
    if (smart.transition && SMART_STATUSES.includes(smart.transition)) {
      await run('UPDATE issues SET status = ? WHERE id = ?', [smart.transition, issue.id])
    }
    appliedTo.push(key)
  }

  res.status(201).json({
    links,
    referencedKeys: keys,
    smartCommit: (smart.comment || smart.time || smart.transition)
      ? { ...smart, appliedTo }
      : null,
  })
}))

// GET /api/issues/:issueId/deployments — list deployments recorded for an issue
router.get('/issues/:issueId/deployments', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const rows = await all(
    `SELECT id, issue_id, environment, status, version, url, deployed_at, created_at
     FROM deployments WHERE issue_id = ? ORDER BY deployed_at DESC`,
    [issueId],
  )
  res.json(rows)
}))

/* ================================================================
   JL-147: Provider webhook (GitHub / GitLab-style JSON payloads)
   Mounted PUBLICLY (no JWT) — external providers can't carry a session.
   Gated by GIT_WEBHOOK_SECRET when set. Kept on its own router so the rest
   of the git routes stay behind `protect`.
   ================================================================ */
export const gitWebhookRouter = Router()

/**
 * Verify the webhook secret gate. When GIT_WEBHOOK_SECRET is unset → open.
 * Accepts EITHER a matching shared token (X-Webhook-Token / X-Gitlab-Token)
 * OR a valid HMAC-SHA256 signature (X-Hub-Signature-256: sha256=<hex>).
 * Reads process.env at call time so tests can toggle it. Returns true if OK.
 */
export function verifyWebhookSecret(req) {
  const secret = process.env.GIT_WEBHOOK_SECRET || ''
  if (!secret) return true // open in dev when unset

  const token = req.get('x-webhook-token') || req.get('x-gitlab-token') || ''
  // Constant-time compare (JL-184) to avoid leaking the secret via timing.
  if (token && safeEqual(token, secret)) return true

  const sig = req.get('x-hub-signature-256') || ''
  if (sig) {
    // JL-188: sign over the RAW request bytes (captured on req.rawBody by the
    // express.json verify hook) so a real GitHub-style signature — computed over
    // the exact bytes the provider sent — matches. Only fall back to a
    // re-serialization of the parsed body when rawBody is unavailable (internal
    // callers / tests that don't wire the verify hook); note that fallback path
    // won't match a genuine provider signature.
    const payload = (req.rawBody && req.rawBody.length)
      ? req.rawBody
      : Buffer.from(JSON.stringify(req.body || {}))
    const expected = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex')
    // safeEqual guards the length so timingSafeEqual can't throw on mismatch.
    if (safeEqual(sig, expected)) {
      return true
    }
  }
  return false
}

// Determine the logical event from the payload / provider headers.
function detectEvent(req) {
  const body = req.body || {}
  if (body.event) return String(body.event).toLowerCase()
  const header = (req.get('x-github-event') || req.get('x-gitlab-event') || '').toLowerCase()
  if (header) return header.replace(/\s+hook$/, '').replace(/\s+/g, '_')
  if (body.pull_request || body.merge_request) return 'pull_request'
  if (body.deployment || body.deployment_status) return 'deployment'
  if (Array.isArray(body.commits) || body.ref) return 'push'
  return 'unknown'
}

// Map a PR payload (action + merged flag) to a canonical state.
function prStateFromPayload(action, merged) {
  if (merged || action === 'merged' || action === 'merge') return 'merged'
  if (action === 'closed' || action === 'close') return 'closed'
  return 'open'
}

// Upsert a pull_request git_link for an issue, setting its state. Loop-safe:
// direct DB writes only. Returns { id, action: 'inserted'|'updated' }.
async function upsertPrLink(issueId, { ref, url, title, author, state, mergedAt }) {
  const existing = await get(
    `SELECT id FROM git_links WHERE issue_id = ? AND link_type = 'pull_request' AND ref = ?`,
    [issueId, ref],
  )
  if (existing) {
    await run(
      `UPDATE git_links SET state = ?, merged_at = ?, url = ?, title = ? WHERE id = ?`,
      [state, mergedAt, url, title, existing.id],
    )
    return { id: existing.id, action: 'updated' }
  }
  const created = await run(
    `INSERT INTO git_links (issue_id, link_type, ref, url, title, author, state, merged_at)
     VALUES (?, 'pull_request', ?, ?, ?, ?, ?, ?)`,
    [issueId, ref, url, title, author, state, mergedAt],
  )
  return { id: created.lastID, action: 'inserted' }
}

// POST /api/git/webhook — ingest a provider event.
gitWebhookRouter.post('/git/webhook', asyncHandler(async (req, res) => {
  if (!verifyWebhookSecret(req)) {
    res.status(401).json({ error: 'Invalid webhook signature/token' })
    return
  }

  const body = req.body || {}
  const event = detectEvent(req)

  if (event === 'pull_request' || event === 'merge_request') {
    const pr = body.pull_request || body.merge_request || {}
    const action = String(body.action || pr.action || pr.state || '').toLowerCase()
    const merged = Boolean(pr.merged || body.merged)
    const number = pr.number ?? pr.iid ?? pr.id
    const branch = pr.head?.ref || pr.source_branch || pr.head_branch || ''
    const title = String(pr.title || '').trim()
    const url = String(pr.html_url || pr.url || pr.web_url || '').trim()
    const author = String(pr.user?.login || pr.author?.username || body.sender?.login || '').trim()
    const mergedAt = merged ? (pr.merged_at || new Date().toISOString()) : null
    const state = prStateFromPayload(action, merged)
    const ref = number != null ? `#${number}` : (branch || title)

    const keys = extractIssueKeysFromRef(`${title} ${branch}`)
    const prLinks = []
    for (const key of keys) {
      const issue = await get('SELECT id FROM issues WHERE issue_key = ?', [key])
      if (!issue) continue
      const result = await upsertPrLink(issue.id, { ref, url, title, author, state, mergedAt })
      prLinks.push({ ...result, issueKey: key, issueId: issue.id, state })
    }
    res.status(200).json({ event: 'pull_request', state, referencedKeys: keys, prLinks })
    return
  }

  if (event === 'push') {
    const branch = String(body.ref || '').replace(/^refs\/heads\//, '')
    const commits = Array.isArray(body.commits) ? body.commits : []
    const results = []
    for (const commit of commits) {
      const message = String(commit?.message || '')
      const sha = String(commit?.id || commit?.sha || '').slice(0, 12)
      const url = String(commit?.url || '')
      const cAuthor = String(commit?.author?.name || commit?.author?.username || body.pusher?.name || '').trim()
      const parsed = parseSmartCommit(message)
      const keys = extractIssueKeysFromRef(`${message} ${branch}`)
      for (const key of keys) {
        const issue = await get('SELECT id FROM issues WHERE issue_key = ?', [key])
        if (!issue) continue
        const created = await run(
          `INSERT INTO git_links (issue_id, link_type, ref, url, title, author)
           VALUES (?, 'commit', ?, ?, ?, ?)`,
          [issue.id, sha || branch || key, url, message.split('\n')[0].slice(0, 200), cAuthor],
        )
        // Apply smart-commit only for the key it targets (or every key if none named).
        if (!parsed.issueKey || parsed.issueKey === key) {
          const applied = await applySmartCommit(parsed, {
            addWorklog: async (time) => {
              const minutes = parseTimeToMinutes(time)
              if (minutes > 0) {
                await run(
                  'INSERT INTO worklogs (issue_id, author, time_spent_minutes, description) VALUES (?, ?, ?, ?)',
                  [issue.id, cAuthor || 'git', minutes, 'via smart commit'],
                )
              }
            },
            addComment: async (text) => {
              await run('INSERT INTO comments (issue_id, author, text) VALUES (?, ?, ?)',
                [issue.id, cAuthor || 'git', text])
            },
            transitionIssue: async (status) => {
              if (SMART_STATUSES.includes(status)) {
                await run('UPDATE issues SET status = ? WHERE id = ?', [status, issue.id])
              }
            },
          })
          results.push({ issueKey: key, linkId: created.lastID, applied })
        } else {
          results.push({ issueKey: key, linkId: created.lastID, applied: [] })
        }
      }
    }
    res.status(200).json({ event: 'push', branch, results })
    return
  }

  if (event === 'deployment' || event === 'deployment_status') {
    const dep = body.deployment || body.deployment_status || body
    const status = String(dep.status || dep.state || body.status || '').trim()
    const environment = String(dep.environment || body.environment || '').trim()
    const version = String(dep.version || dep.ref || dep.sha || body.version || '').trim()
    const url = String(dep.url || dep.target_url || dep.log_url || body.url || '').trim()
    const desc = String(dep.description || dep.ref || '')

    const keys = extractIssueKeysFromRef(`${desc} ${version} ${environment}`)
    let issueId = null
    for (const key of keys) {
      const issue = await get('SELECT id FROM issues WHERE issue_key = ?', [key])
      if (issue) { issueId = issue.id; break }
    }
    const created = await run(
      `INSERT INTO deployments (issue_id, environment, status, version, url)
       VALUES (?, ?, ?, ?, ?)`,
      [issueId, environment, status, version, url],
    )
    res.status(201).json({ event: 'deployment', id: created.lastID, issueId, environment, status })
    return
  }

  res.status(200).json({ event: 'unknown', message: 'No handler for event', received: event })
}))

export default router
