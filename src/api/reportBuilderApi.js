import { api } from './client.js'

// Builder vocabulary — mirrors server/routes/reportBuilder.js.
export const REPORT_DIMENSIONS = [
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'priority', label: 'Priority' },
  { key: 'issue_type', label: 'Issue type' },
  { key: 'project', label: 'Project' },
  { key: 'label', label: 'Label' },
]

export const REPORT_MEASURES = [
  { key: 'count', label: 'Issue count' },
  { key: 'sum_story_points', label: 'Sum of story points' },
  { key: 'avg_cycle_time', label: 'Avg cycle time (hours)' },
]

export const REPORT_CHART_TYPES = [
  { key: 'bar', label: 'Bar' },
  { key: 'line', label: 'Line' },
  { key: 'pie', label: 'Pie' },
  { key: 'table', label: 'Table' },
]

// Filterable fields exposed in the builder's filter row.
export const REPORT_FILTER_FIELDS = [
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'issue_type', label: 'Issue type' },
  { key: 'project_id', label: 'Project ID' },
]

export function runReport(definition, filters) {
  return api('/api/report-builder/run', {
    method: 'POST',
    body: JSON.stringify({ definition, filters }),
  })
}

export function fetchSavedReports() {
  return api('/api/report-builder/reports')
}

export function createSavedReport(payload) {
  return api('/api/report-builder/reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateSavedReport(id, payload) {
  return api(`/api/report-builder/reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteSavedReport(id) {
  return api(`/api/report-builder/reports/${id}`, { method: 'DELETE' })
}
