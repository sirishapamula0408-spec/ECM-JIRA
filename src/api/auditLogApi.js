import { api } from './client.js'

const TOKEN_KEY = 'jira_auth_token'
function authHeader() {
  let token = null
  try {
    token = window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY) || null
  } catch { token = null }
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export const fetchAuditLog = (filters = {}) => {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, v)
  })
  const qs = params.toString()
  return api(`/api/audit-log${qs ? `?${qs}` : ''}`)
}

export const verifyAuditLog = () => api('/api/audit-log/verify')

export const purgeAuditLog = (retentionDays) =>
  api('/api/audit-log/retention', { method: 'POST', body: JSON.stringify({ retentionDays }) })

// Downloads use a raw fetch because api() always parses JSON (JL-40 pattern).
export async function downloadAuditExport(format = 'csv', filters = {}) {
  const params = new URLSearchParams({ format })
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, v)
  })
  const res = await fetch(`/api/audit-log/export?${params.toString()}`, { headers: { ...authHeader() } })
  if (!res.ok) throw new Error(`Export failed (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-log.${format}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
