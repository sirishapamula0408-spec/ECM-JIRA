// JL-190: Backlog bulk toolbar — pure selection + result helpers.
// Selection is a plain array of issue ids shared by every panel, so the
// "N selected" count is simply its length across sections.

export function toggleId(selected, id) {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
}

// Select or deselect every id of one section, leaving other sections alone.
export function setSection(selected, sectionIds, checked) {
  if (checked) return Array.from(new Set([...selected, ...sectionIds]))
  const drop = new Set(sectionIds)
  return selected.filter((id) => !drop.has(id))
}

// 'none' | 'some' | 'all' — drives a section checkbox (some = indeterminate).
export function sectionState(selected, sectionIds) {
  if (sectionIds.length === 0) return 'none'
  const chosen = new Set(selected)
  const count = sectionIds.reduce((n, id) => n + (chosen.has(id) ? 1 : 0), 0)
  if (count === 0) return 'none'
  return count === sectionIds.length ? 'all' : 'some'
}

// Value-select sentinels: '' means "nothing chosen yet", so these two real
// choices need values of their own.
export const UNASSIGNED_VALUE = '__unassigned__'
export const BACKLOG_VALUE = '__backlog__'

// Toolbar fields that need a value. Watch/Unwatch/Delete are value-less actions.
export const VALUE_FIELDS = ['status', 'assignee', 'priority', 'sprint', 'issueType', 'labels']

// One toolbar choice → the POST /api/issues/bulk `operations` object.
export function bulkOperation(field, value) {
  switch (field) {
    case 'status': return { status: value }
    case 'priority': return { priority: value }
    case 'issueType': return { issueType: value }
    case 'assignee': return { assignee: value === UNASSIGNED_VALUE ? null : value }
    case 'sprint': return { sprintId: value === BACKLOG_VALUE ? null : Number(value) }
    case 'labels': return { addLabels: [value] }
    case 'delete': return { delete: true }
    default: return null
  }
}

const plural = (n) => `${n} work item${n === 1 ? '' : 's'}`

// Turn a POST /api/issues/bulk response into the toast text, plus the ids that
// failed (they stay selected so the user can retry or adjust them).
//   "3 work items updated"
//   "2 updated, 1 failed (ECM-8: Transition from … is not allowed)"
export function summarizeBulkResult(response, verb = 'updated') {
  const results = Array.isArray(response?.results) ? response.results : []
  const applied = results.filter((r) => r.applied)
  const failed = results.filter((r) => !r.applied && r.error)
  const unchanged = results.filter((r) => !r.applied && !r.error)
  const failedIds = failed.map((r) => r.issueId)

  if (failed.length === 0) {
    if (applied.length === 0) {
      return { severity: 'info', message: `No changes — the selected work items already have that value`, failedIds }
    }
    const tail = unchanged.length ? ` (${unchanged.length} already up to date)` : ''
    return { severity: 'success', message: `${plural(applied.length)} ${verb}${tail}`, failedIds }
  }

  const reasons = failed.slice(0, 3).map((r) => `${r.key || `#${r.issueId}`}: ${r.error}`)
  if (failed.length > 3) reasons.push(`+${failed.length - 3} more`)
  const head = applied.length ? `${applied.length} ${verb}, ` : ''
  return {
    severity: applied.length ? 'warning' : 'error',
    message: `${head}${failed.length} failed (${reasons.join('; ')})`,
    failedIds,
  }
}
