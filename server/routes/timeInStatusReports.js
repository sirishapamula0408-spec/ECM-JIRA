import { Router } from 'express'
import { all, get } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import {
  aggregateTimeInStatus,
  computeCycleTimeHours,
  firstTransitionTime,
  computeControlChart,
} from '../services/timeInStatusReport.js'

// JL-155: Time-in-status metrics & control chart.
// Mounted at /api so paths are absolute (Theme-1 convention):
//   GET /api/projects/:id/reports/time-in-status
//   GET /api/projects/:id/reports/control-chart
const router = Router({ mergeParams: true })

// Canonical status order for stable columns/legends across the analytics UI.
const STATUS_ORDER = ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done']

const parseProjectId = (raw) =>
  raw !== undefined && raw !== null && raw !== '' && Number.isInteger(Number(raw)) && Number(raw) > 0
    ? Number(raw)
    : null

// Load a project's issues plus their ordered status change-history, grouped by
// issue id. Returns { project, issues:[{id, issueKey, currentStatus, createdAt,
// changes}] } or null (after sending an error) when the project is invalid.
async function loadProjectHistory(req, res) {
  const projectId = parseProjectId(req.params.id)
  if (projectId === null) {
    res.status(400).json({ error: 'Invalid project id' })
    return null
  }

  const project = await get('SELECT id FROM projects WHERE id = ?', [projectId])
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return null
  }

  const issueRows = await all(
    'SELECT id, issue_key, status, created_at FROM issues WHERE project_id = ?',
    [projectId],
  )

  const historyByIssue = new Map()
  if (issueRows.length) {
    const ids = issueRows.map((r) => r.id)
    const placeholders = ids.map(() => '?').join(', ')
    const history = await all(
      `SELECT issue_id, old_value, new_value, changed_at FROM issue_history
       WHERE field = 'status' AND issue_id IN (${placeholders})
       ORDER BY changed_at ASC, id ASC`,
      ids,
    )
    for (const h of history) {
      if (!historyByIssue.has(h.issue_id)) historyByIssue.set(h.issue_id, [])
      historyByIssue.get(h.issue_id).push({
        oldValue: h.old_value,
        newValue: h.new_value,
        changedAt: new Date(h.changed_at).getTime(),
      })
    }
  }

  const issues = issueRows.map((r) => ({
    id: r.id,
    issueKey: r.issue_key,
    currentStatus: r.status,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
    changes: historyByIssue.get(r.id) || [],
  }))

  return { projectId, issues }
}

// GET /api/projects/:id/reports/time-in-status
// Per-issue and aggregated milliseconds/hours spent in each status, from the
// change history.
router.get('/projects/:id/reports/time-in-status', asyncHandler(async (req, res) => {
  const loaded = await loadProjectHistory(req, res)
  if (!loaded) return

  const { projectId, issues } = loaded
  const { statuses, perIssue, totals } = aggregateTimeInStatus(issues, {
    endTime: Date.now(),
    statusOrder: STATUS_ORDER,
  })

  res.json({ projectId, statuses, perIssue, totals })
}))

// GET /api/projects/:id/reports/control-chart?window=7
// Cycle-time scatter (one point per completed issue) with a trailing rolling
// mean and standard deviation.
router.get('/projects/:id/reports/control-chart', asyncHandler(async (req, res) => {
  const loaded = await loadProjectHistory(req, res)
  if (!loaded) return

  const { projectId, issues } = loaded

  const windowRaw = Number(req.query.window)
  const windowSize = Number.isFinite(windowRaw) && windowRaw > 0 ? Math.floor(windowRaw) : 7

  const rawPoints = []
  for (const issue of issues) {
    const doneAt = firstTransitionTime(issue.changes, 'Done')
    if (doneAt === null) continue
    const cycleTimeHours = computeCycleTimeHours(issue.changes, { createdAt: issue.createdAt })
    if (cycleTimeHours === null) continue
    rawPoints.push({
      issueKey: issue.issueKey,
      resolvedAt: new Date(doneAt).toISOString(),
      cycleTimeHours,
    })
  }

  const chart = computeControlChart(rawPoints, { window: windowSize })
  res.json({ projectId, ...chart })
}))

export default router
