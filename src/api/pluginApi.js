import { api } from './client.js'

// JL-145: Plugin/app framework — declarative extension-point manifests.

export const fetchPlugins = () => api('/api/plugins')

export const fetchPlugin = (id) => api(`/api/plugins/${id}`)

export const fetchExtensionPoints = () => api('/api/plugins/extension-points')

/** Merged, safe (host-sanitized) contributions for one extension point. */
export const fetchContributions = (extensionPoint) =>
  api(`/api/plugins/contributions/${encodeURIComponent(extensionPoint)}`)

export const registerPlugin = (data) =>
  api('/api/plugins', { method: 'POST', body: JSON.stringify(data) })

export const updatePlugin = (id, data) =>
  api(`/api/plugins/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deletePlugin = (id) =>
  api(`/api/plugins/${id}`, { method: 'DELETE' })
