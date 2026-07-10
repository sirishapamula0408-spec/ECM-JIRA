import { api } from './client.js'

const TOKEN_KEY = 'jira_auth_token'
function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

// Schema/metadata is small JSON — safe to use the shared client.
export const fetchBiSchema = () => api('/api/bi/schema')

// Trigger a browser download from a raw endpoint. The shared api() client always
// parses JSON, which would corrupt CSV/NDJSON payloads, so we use raw fetch here
// (per CLAUDE.md note) and stream the response into a Blob download.
async function download(url, filename) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

// Incremental issues fact export. `since` is an ISO string (optional).
export function downloadIssuesExport({ since = '', format = 'json' } = {}) {
  const params = new URLSearchParams()
  if (since) params.set('since', since)
  params.set('format', format)
  const ext = format === 'csv' ? 'csv' : format === 'ndjson' ? 'ndjson' : 'json'
  return download(`/api/bi/export/issues?${params.toString()}`, `bi-issues.${ext}`)
}

// Dimension table export (projects|users|statuses|priorities|types).
export function downloadDimensionExport(name, format = 'json') {
  const ext = format === 'csv' ? 'csv' : format === 'ndjson' ? 'ndjson' : 'json'
  return download(`/api/bi/export/dimensions/${name}?format=${format}`, `bi-dim-${name}.${ext}`)
}
