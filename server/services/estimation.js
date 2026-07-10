// JL-126: Configurable estimation statistic per board.
// Pure helpers for computing sprint/backlog totals by the configured statistic.

// Allowed estimation statistics for a board.
export const ESTIMATION_STATISTICS = ['story_points', 'time_estimate', 'issue_count']

export const DEFAULT_ESTIMATION_STATISTIC = 'story_points'

// Validate a statistic value; returns true when it is one of the allowed enum.
export function isValidEstimationStatistic(statistic) {
  return ESTIMATION_STATISTICS.includes(statistic)
}

// Coerce a value to a finite number, or null when it is not numeric.
function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Compute the estimation total for a set of issues by the configured statistic.
 *
 *  - 'story_points'  → sums each issue's `story_points` (nulls/missing ignored)
 *  - 'time_estimate' → sums each issue's `original_estimate_minutes` (in minutes)
 *  - 'issue_count'   → counts the issues (each row counts as 1)
 *
 * Pure function — no DB access. Unknown statistic falls back to counting rows
 * only for 'issue_count'; any other unknown value returns 0.
 *
 * @param {Array<object>} issues
 * @param {string} statistic
 * @returns {number}
 */
export function computeEstimationTotal(issues, statistic = DEFAULT_ESTIMATION_STATISTIC) {
  const rows = Array.isArray(issues) ? issues : []

  if (statistic === 'issue_count') {
    return rows.length
  }

  const field = statistic === 'time_estimate' ? 'original_estimate_minutes' : 'story_points'
  if (statistic !== 'story_points' && statistic !== 'time_estimate') {
    return 0
  }

  let total = 0
  for (const issue of rows) {
    if (!issue || typeof issue !== 'object') continue
    const value = toNumberOrNull(issue[field])
    if (value !== null) total += value
  }
  return total
}
