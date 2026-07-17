import { Router } from 'express'
import { all, get } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

/* ================================================================
   JL-154: Cross-project portfolio analytics (multi-project rollup)

   Rolls up KPIs across ALL projects the caller can see (project member
   or project lead), optionally scoped to the active workspace. Reuses
   the same accessible-project scoping as projects.js so we never leak
   cross-workspace / cross-membership data.
   ================================================================ */

const MS_PER_DAY = 1000 * 60 * 60 * 24

// Start-of-today (UTC) — the cut-off for "overdue".
function startOfTodayMs() {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

const parseMs = (value) => {
  if (value === null || value === undefined || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

// A single project's completion percentage: done / total, rounded; 0 when empty.
export function completionPct(done, total) {
  if (!total || total <= 0) return 0
  return Math.round((Number(done) / Number(total)) * 100)
}

/**
 * Pure, unit-testable roll-up. Sums per-project totals and computes the
 * overall completion percentage across the whole portfolio.
 *
 * @param {Array<{total:number, open:number, done:number, overdue:number}>} perProjectRows
 * @returns {{projectCount:number, total:number, open:number, done:number, overdue:number, completionPct:number}}
 */
export function rollupPortfolio(perProjectRows) {
  const rows = Array.isArray(perProjectRows) ? perProjectRows : []
  const agg = rows.reduce(
    (acc, r) => {
      acc.total += Number(r?.total) || 0
      acc.open += Number(r?.open) || 0
      acc.done += Number(r?.done) || 0
      acc.overdue += Number(r?.overdue) || 0
      return acc
    },
    { total: 0, open: 0, done: 0, overdue: 0 },
  )
  return {
    projectCount: rows.length,
    total: agg.total,
    open: agg.open,
    done: agg.done,
    overdue: agg.overdue,
    completionPct: completionPct(agg.done, agg.total),
  }
}

// GET /api/portfolio/summary
// Per-project KPI rows + an aggregate roll-up across the caller's projects.
router.get('/portfolio/summary', asyncHandler(async (req, res) => {
  const userEmail = req.user?.email
  if (!userEmail) {
    res.json({ projects: [], aggregate: rollupPortfolio([]), throughput30d: 0 })
    return
  }

  // Same accessibility rule as projects.js GET /: projects where the caller is
  // a project member or the project lead. Optionally scoped to the resolved
  // workspace so we never surface projects from another tenant.
  const workspaceId = req.workspaceId ?? null
  const member = await get('SELECT id, name FROM members WHERE LOWER(email) = LOWER(?)', [userEmail])

  let projects
  if (member) {
    projects = await all(
      `SELECT DISTINCT p.id, p.key, p.name FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.member_id = ?
       WHERE (pm.member_id IS NOT NULL OR LOWER(p.lead) = LOWER(?))
         AND (? IS NULL OR p.workspace_id = ?)
       ORDER BY p.id ASC`,
      [member.id, member.name, workspaceId, workspaceId],
    )
  } else {
    projects = await all(
      `SELECT id, key, name FROM projects
       WHERE LOWER(lead) = LOWER(?)
         AND (? IS NULL OR workspace_id = ?)
       ORDER BY id ASC`,
      [userEmail, workspaceId, workspaceId],
    )
  }

  projects = projects || []
  if (projects.length === 0) {
    res.json({ projects: [], aggregate: rollupPortfolio([]), throughput30d: 0 })
    return
  }

  const projectIds = projects.map((p) => p.id)
  const placeholders = projectIds.map(() => '?').join(', ')
  const issues = await all(
    `SELECT project_id, status, due_date, updated_at
       FROM issues
      WHERE project_id IN (${placeholders})`,
    projectIds,
  )

  const todayMs = startOfTodayMs()
  const throughputCutoff = todayMs - 30 * MS_PER_DAY

  // Seed a stats bucket per accessible project so projects with zero issues
  // still appear in the breakdown.
  const stats = new Map()
  for (const p of projects) {
    stats.set(p.id, { total: 0, open: 0, done: 0, overdue: 0 })
  }

  let throughput30d = 0
  for (const row of issues || []) {
    const bucket = stats.get(row.project_id)
    if (!bucket) continue
    bucket.total += 1
    const isDone = row.status === 'Done'
    if (isDone) {
      bucket.done += 1
      const doneMs = parseMs(row.updated_at)
      if (doneMs !== null && doneMs >= throughputCutoff) throughput30d += 1
    } else {
      bucket.open += 1
      const dueMs = parseMs(row.due_date)
      if (dueMs !== null && dueMs < todayMs) bucket.overdue += 1
    }
  }

  const perProject = projects.map((p) => {
    const b = stats.get(p.id)
    return {
      projectId: p.id,
      projectKey: p.key,
      name: p.name,
      total: b.total,
      open: b.open,
      done: b.done,
      overdue: b.overdue,
      completionPct: completionPct(b.done, b.total),
    }
  })

  res.json({
    projects: perProject,
    aggregate: rollupPortfolio(perProject),
    throughput30d,
  })
}))

export default router
