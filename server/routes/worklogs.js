import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

const MIN_PER = { d: 480, h: 60, m: 1 } // 1d = 8h working day

// Parse "2h 30m", "1d 4h", "45m", or a bare number (minutes) → integer minutes
export function parseTimeToMinutes(input) {
  if (input === null || input === undefined) return null
  const s = String(input).trim().toLowerCase()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s) // bare number = minutes
  const re = /(\d+(?:\.\d+)?)\s*([dhm])/g
  let total = 0
  let matched = false
  let m
  while ((m = re.exec(s)) !== null) {
    matched = true
    total += Math.round(Number(m[1]) * MIN_PER[m[2]])
  }
  return matched ? total : null
}

export function formatMinutes(min) {
  if (min == null) return null
  if (min === 0) return '0m'
  const d = Math.floor(min / 480)
  const h = Math.floor((min % 480) / 60)
  const m = min % 60
  return [d ? `${d}d` : '', h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ')
}

async function buildSummary(issueId) {
  const issue = await get('SELECT original_estimate_minutes FROM issues WHERE id = ?', [issueId])
  const spentRow = await get('SELECT COALESCE(SUM(time_spent_minutes), 0)::int AS spent FROM worklogs WHERE issue_id = ?', [issueId])
  const estimate = issue?.original_estimate_minutes ?? null
  const spent = spentRow?.spent ?? 0
  const remaining = estimate != null ? Math.max(0, estimate - spent) : null
  return {
    estimateMinutes: estimate,
    spentMinutes: spent,
    remainingMinutes: remaining,
    estimateText: formatMinutes(estimate),
    spentText: formatMinutes(spent),
    remainingText: formatMinutes(remaining),
    percent: estimate ? Math.min(100, Math.round((spent / estimate) * 100)) : null,
  }
}

// GET /api/issues/:issueId/worklogs — worklogs + time summary
router.get('/issues/:issueId/worklogs', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const worklogs = await all(
    'SELECT id, issue_id, author, time_spent_minutes, description, created_at FROM worklogs WHERE issue_id = ? ORDER BY created_at DESC',
    [issueId],
  )
  res.json({
    worklogs: worklogs.map((w) => ({ ...w, timeSpentText: formatMinutes(w.time_spent_minutes) })),
    summary: await buildSummary(issueId),
  })
}))

// POST /api/issues/:issueId/worklogs — { timeSpent, description }
router.post('/issues/:issueId/worklogs', requireRole('Member'), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const issue = await get('SELECT id FROM issues WHERE id = ?', [issueId])
  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return }

  const minutes = parseTimeToMinutes(req.body?.timeSpent)
  if (minutes == null || minutes <= 0) {
    res.status(400).json({ error: 'timeSpent must be like "2h 30m", "45m", or a number of minutes' })
    return
  }
  const author = req.user.email
  const description = String(req.body?.description || '').trim()
  await run(
    'INSERT INTO worklogs (issue_id, author, time_spent_minutes, description) VALUES (?, ?, ?, ?)',
    [issueId, author, minutes, description],
  )
  res.status(201).json(await buildSummary(issueId))
}))

// DELETE /api/worklogs/:id
router.delete('/worklogs/:id', requireRole('Member'), asyncHandler(async (req, res) => {
  const row = await get('SELECT issue_id FROM worklogs WHERE id = ?', [Number(req.params.id)])
  if (!row) { res.status(404).json({ error: 'Worklog not found' }); return }
  await run('DELETE FROM worklogs WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true, summary: await buildSummary(row.issue_id) })
}))

// PUT /api/issues/:issueId/estimate — { estimate } (string or minutes; empty clears)
router.put('/issues/:issueId/estimate', requireRole('Member'), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const issue = await get('SELECT id FROM issues WHERE id = ?', [issueId])
  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return }

  const raw = req.body?.estimate
  let minutes = null
  if (raw !== '' && raw !== null && raw !== undefined) {
    minutes = parseTimeToMinutes(raw)
    if (minutes == null || minutes < 0) {
      res.status(400).json({ error: 'estimate must be like "1d 4h", "3h", or a number of minutes' })
      return
    }
  }
  await run('UPDATE issues SET original_estimate_minutes = ? WHERE id = ?', [minutes, issueId])
  res.json(await buildSummary(issueId))
}))

export default router
