import { api } from './client.js'

const TOKEN_KEY = 'jira_auth_token'
function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

// Export triggers a file download (CSV or JSON). Uses a raw fetch because the
// shared api() client always parses JSON, which would corrupt CSV payloads.
export async function downloadProjectExport(projectId, format = 'csv') {
  const res = await fetch(`/api/projects/${projectId}/export?format=${format}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `project-${projectId}-issues.${format}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// CSV import — dryRun returns a validation preview; dryRun:false commits.
export const importIssues = (projectId, { csv, mapping, dryRun }) =>
  api(`/api/projects/${projectId}/import`, {
    method: 'POST',
    body: JSON.stringify({ csv, mapping, dryRun }),
  })
