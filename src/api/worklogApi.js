import { api } from './client.js'

export const fetchWorklogs = (issueId) =>
  api(`/api/issues/${issueId}/worklogs`)

export const logWork = (issueId, { timeSpent, description }) =>
  api(`/api/issues/${issueId}/worklogs`, { method: 'POST', body: JSON.stringify({ timeSpent, description }) })

export const deleteWorklog = (worklogId) =>
  api(`/api/worklogs/${worklogId}`, { method: 'DELETE' })

export const setEstimate = (issueId, estimate) =>
  api(`/api/issues/${issueId}/estimate`, { method: 'PUT', body: JSON.stringify({ estimate }) })

// JL-240: Project worklog timesheet rollup (grouped by user/date, minute totals).
export const fetchProjectTimesheet = (projectId, { from, to } = {}) => {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString()
  return api(`/api/projects/${projectId}/worklogs${qs ? `?${qs}` : ''}`)
}

const TOKEN_KEY = 'jira_auth_token'
function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

// JL-240: CSV download via raw fetch + Bearer — the shared api() client always
// parses JSON, which would corrupt the CSV payload.
export async function downloadProjectTimesheetCsv(projectId, { from, to } = {}) {
  const params = new URLSearchParams({ format: 'csv' })
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const res = await fetch(`/api/projects/${projectId}/worklogs?${params.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new Error('Timesheet export failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `project-${projectId}-timesheet.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
