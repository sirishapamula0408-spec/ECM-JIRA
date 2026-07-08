import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

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

export default router
