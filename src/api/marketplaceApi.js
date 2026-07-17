import { api } from './client.js'

export const fetchApps = ({ search, category } = {}) => {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (category) params.set('category', category)
  const qs = params.toString()
  return api(`/api/marketplace/apps${qs ? `?${qs}` : ''}`)
}

export const fetchApp = (key) => api(`/api/marketplace/apps/${key}`)

export const registerApp = (data) =>
  api('/api/marketplace/apps', { method: 'POST', body: JSON.stringify(data) })

export const deleteApp = (id) =>
  api(`/api/marketplace/apps/${id}`, { method: 'DELETE' })

export const installApp = (id, config) =>
  api(`/api/marketplace/apps/${id}/install`, {
    method: 'POST',
    body: JSON.stringify({ config: config || {} }),
  })

export const uninstallApp = (id) =>
  api(`/api/marketplace/apps/${id}/uninstall`, { method: 'POST' })

export const fetchInstalled = () => api('/api/marketplace/installed')

export const updateInstalled = (id, data) =>
  api(`/api/marketplace/installed/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
