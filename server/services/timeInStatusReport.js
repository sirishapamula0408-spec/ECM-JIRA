/**
 * JL-155: Time-in-status metrics & control chart.
 *
 * Pure computation helpers (no DB / no Express) so they can be unit-tested in
 * isolation. They derive durations and cycle-time statistics from the ordered
 * status change-history recorded by JL-82 (`issue_history` rows where
 * field = 'status', carrying old_value / new_value / changed_at).
 */

const MS_PER_HOUR = 1000 * 60 * 60

const round2 = (n) => (Number.isFinite(n) ? Number(n.toFixed(2)) : n)

// Normalise a raw issue_history row (or an already-shaped object) into
// { oldValue, newValue, changedAt(ms) }. Rows whose timestamp cannot be parsed
// are dropped by the callers below.
export function normalizeChange(row) {
  if (!row) return null
  const oldValue = row.oldValue ?? row.old_value ?? null
  const newValue = row.newValue ?? row.new_value ?? null
  const rawAt = row.changedAt ?? row.changed_at ?? null
  const at = typeof rawAt === 'number' ? rawAt : new Date(rawAt).getTime()
  if (!Number.isFinite(at)) return null
  return { oldValue, newValue, changedAt: at }
}

// Sort status changes ascending by timestamp (stable, non-mutating).
function sortChanges(changes) {
  return (Array.isArray(changes) ? changes : [])
    .map(normalizeChange)
    .filter(Boolean)
    .sort((a, b) => a.changedAt - b.changedAt)
}

/**
 * Total milliseconds an issue spent in each status, derived from its ordered
 * status change list.
 *
 * Each change row means "at changedAt the status became newValue". The interval
 * a status was held runs from the change that entered it until the next change
 * (or `endTime` for the current status). When `createdAt` is supplied, the
 * issue's initial status (the first change's old_value) is credited from
 * creation until the first change.
 *
 * Empty history → {} (nothing can be inferred without at least one transition).
 *
 * @param {Array} changes  issue_history rows (raw or normalized)
 * @param {{createdAt?: number|string|null, endTime?: number|string}} [opts]
 * @returns {Object<string, number>} status → total ms (only positive durations)
 */
export function computeTimeInStatus(changes, opts = {}) {
  const result = {}
  const sorted = sortChanges(changes)
  if (sorted.length === 0) return result

  const createdAtRaw = opts.createdAt ?? null
  const createdAt = createdAtRaw === null || createdAtRaw === undefined
    ? null
    : (typeof createdAtRaw === 'number' ? createdAtRaw : new Date(createdAtRaw).getTime())
  const endRaw = opts.endTime ?? Date.now()
  const endTime = typeof endRaw === 'number' ? endRaw : new Date(endRaw).getTime()

  const add = (status, ms) => {
    if (!status || !Number.isFinite(ms) || ms <= 0) return
    result[status] = (result[status] || 0) + ms
  }

  // Initial status: from creation until the first recorded change.
  const first = sorted[0]
  if (createdAt !== null && Number.isFinite(createdAt) && first.oldValue) {
    add(first.oldValue, first.changedAt - createdAt)
  }

  // Each change's new_value is held until the following change (or endTime).
  for (let i = 0; i < sorted.length; i += 1) {
    const start = sorted[i].changedAt
    const end = i + 1 < sorted.length ? sorted[i + 1].changedAt : endTime
    add(sorted[i].newValue, end - start)
  }

  return result
}

// First timestamp (ms) at which the issue transitioned to `status`, or null.
export function firstTransitionTime(changes, status) {
  const sorted = sortChanges(changes)
  for (const c of sorted) {
    if (c.newValue === status) return c.changedAt
  }
  return null
}

/**
 * Cycle time in hours: from first entering 'In Progress' to first reaching
 * 'Done'. Falls back to createdAt → Done (lead time) when there is no recorded
 * 'In Progress'. Returns null when the issue never reached 'Done' or the span
 * cannot be computed.
 */
export function computeCycleTimeHours(changes, opts = {}) {
  const sorted = sortChanges(changes)
  let inProgress = null
  let done = null
  for (const c of sorted) {
    if (c.newValue === 'In Progress' && inProgress === null) inProgress = c.changedAt
    if (c.newValue === 'Done' && done === null) done = c.changedAt
  }
  if (done === null) return null

  const createdRaw = opts.createdAt ?? null
  const createdAt = createdRaw === null || createdRaw === undefined
    ? null
    : (typeof createdRaw === 'number' ? createdRaw : new Date(createdRaw).getTime())

  const start = inProgress !== null ? inProgress : createdAt
  if (start === null || !Number.isFinite(start)) return null
  const ms = done - start
  if (!(ms >= 0)) return null
  return round2(ms / MS_PER_HOUR)
}

// Population mean + standard deviation of a numeric array.
function meanStd(values) {
  const arr = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v))
  if (arr.length === 0) return { mean: 0, std: 0 }
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length
  return { mean, std: Math.sqrt(variance) }
}

/**
 * Control chart data for completed issues: a cycle-time scatter with a trailing
 * rolling mean and standard deviation over the last `window` points.
 *
 * @param {Array<{issueKey, resolvedAt, cycleTimeHours}>} points
 * @param {{window?: number}} [opts]
 * @returns {{window, count, mean, std, points: Array}}
 */
export function computeControlChart(points, opts = {}) {
  const w = Number.isFinite(opts.window) && opts.window > 0 ? Math.floor(opts.window) : 7

  const pts = (Array.isArray(points) ? points : [])
    .filter((p) => p && Number.isFinite(p.cycleTimeHours) && p.resolvedAt)
    .map((p) => ({
      issueKey: p.issueKey,
      resolvedAt: p.resolvedAt,
      cycleTimeHours: p.cycleTimeHours,
      resolvedMs: new Date(p.resolvedAt).getTime(),
    }))
    .filter((p) => Number.isFinite(p.resolvedMs))
    .sort((a, b) => a.resolvedMs - b.resolvedMs)

  const enriched = pts.map((p, i) => {
    const start = Math.max(0, i - w + 1)
    const windowVals = pts.slice(start, i + 1).map((x) => x.cycleTimeHours)
    const { mean, std } = meanStd(windowVals)
    return {
      issueKey: p.issueKey,
      resolvedAt: p.resolvedAt,
      cycleTimeHours: p.cycleTimeHours,
      rollingMean: round2(mean),
      rollingStd: round2(std),
      // Upper / lower control bands (mean ± 1σ, clamped at 0) for charting.
      upper: round2(mean + std),
      lower: round2(Math.max(0, mean - std)),
    }
  })

  const overall = meanStd(pts.map((p) => p.cycleTimeHours))

  return {
    window: w,
    count: pts.length,
    mean: pts.length ? round2(overall.mean) : null,
    std: pts.length ? round2(overall.std) : null,
    points: enriched,
  }
}

/**
 * Aggregate per-issue and project-wide time-in-status from grouped history.
 *
 * @param {Array<{issueKey, currentStatus, createdAt, changes}>} issues
 * @param {{endTime?: number, statusOrder?: string[]}} [opts]
 */
export function aggregateTimeInStatus(issues, opts = {}) {
  const endTime = opts.endTime ?? Date.now()
  const statusOrder = Array.isArray(opts.statusOrder) ? opts.statusOrder : []

  const totalsMs = {}
  const seen = new Set(statusOrder)
  const extra = []

  const perIssue = (Array.isArray(issues) ? issues : []).map((issue) => {
    const ms = computeTimeInStatus(issue.changes, { createdAt: issue.createdAt, endTime })
    const byStatus = {}
    let totalMs = 0
    for (const [status, value] of Object.entries(ms)) {
      byStatus[status] = { ms: value, hours: round2(value / MS_PER_HOUR) }
      totalMs += value
      totalsMs[status] = (totalsMs[status] || 0) + value
      if (!seen.has(status)) { seen.add(status); extra.push(status) }
    }
    return {
      issueKey: issue.issueKey,
      currentStatus: issue.currentStatus ?? null,
      byStatus,
      totalMs,
      totalHours: round2(totalMs / MS_PER_HOUR),
    }
  })

  const statuses = [...statusOrder.filter((s) => totalsMs[s] !== undefined), ...extra]
  const totals = {}
  for (const status of statuses) {
    totals[status] = { ms: totalsMs[status], hours: round2(totalsMs[status] / MS_PER_HOUR) }
  }

  return { statuses, perIssue, totals }
}
