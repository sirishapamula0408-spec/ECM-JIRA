import { ISSUE_STATUSES, ISSUE_TYPES, PRIORITIES } from '../constants'

// Backlog "Filter" menu — field-based filters applied client-side on top of
// search and "My open issues". Values within a field are OR'd; fields are AND'd,
// which is how Jira's backlog filters combine.

export const UNASSIGNED = '__unassigned__'

export const FILTER_FIELDS = [
  { key: 'issueType', label: 'Type' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
]

const FIELD_ORDER = { issueType: ISSUE_TYPES, priority: PRIORITIES, status: ISSUE_STATUSES }

export const EMPTY_FILTERS = Object.freeze({ issueType: [], priority: [], status: [], assignee: [] })

function fieldValue(issue, key) {
  if (key === 'assignee') return issue.assignee ? String(issue.assignee) : UNASSIGNED
  return issue[key] ? String(issue[key]) : ''
}

export function countActiveFilters(filters) {
  return FILTER_FIELDS.reduce((total, { key }) => total + (filters[key]?.length || 0), 0)
}

export function matchesFilters(issue, filters) {
  return FILTER_FIELDS.every(({ key }) => {
    const selected = filters[key]
    return !selected?.length || selected.includes(fieldValue(issue, key))
  })
}

// The values offered per field are the ones present on the scoped issues, so
// every option narrows to at least one issue. Known values keep the app's
// canonical order (e.g. Low → Medium → High); the rest sort alphabetically.
export function buildFilterOptions(issues) {
  const options = {}
  for (const { key } of FILTER_FIELDS) {
    const present = new Set()
    for (const issue of issues) {
      const value = fieldValue(issue, key)
      if (value) present.add(value)
    }
    const order = FIELD_ORDER[key] || []
    const rank = (value) => {
      if (value === UNASSIGNED) return -1
      const index = order.indexOf(value)
      return index === -1 ? order.length : index
    }
    options[key] = [...present].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  }
  return options
}

export function toggleFilterValue(filters, key, value) {
  const current = filters[key] || []
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  return { ...filters, [key]: next }
}
