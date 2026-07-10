import { api } from './client.js'

// --- Asset types ---
export const fetchAssetTypes = () => api('/api/asset-types')

export const createAssetType = ({ name, icon = '' }) =>
  api('/api/asset-types', { method: 'POST', body: JSON.stringify({ name, icon }) })

// --- Assets ---
export const fetchAssets = ({ search = '', type = '' } = {}) => {
  const qs = new URLSearchParams()
  if (search) qs.set('search', search)
  if (type) qs.set('type', type)
  const q = qs.toString()
  return api(`/api/assets${q ? `?${q}` : ''}`)
}

export const fetchAsset = (id) => api(`/api/assets/${id}`)

export const createAsset = (payload) =>
  api('/api/assets', { method: 'POST', body: JSON.stringify(payload) })

export const updateAsset = (id, payload) =>
  api(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })

export const deleteAsset = (id) =>
  api(`/api/assets/${id}`, { method: 'DELETE' })

// --- Issue <-> Asset linking ---
export const fetchIssueAssets = (issueId) => api(`/api/issues/${issueId}/assets`)

export const linkIssueAsset = (issueId, assetId) =>
  api(`/api/issues/${issueId}/assets`, { method: 'POST', body: JSON.stringify({ assetId }) })

export const unlinkIssueAsset = (issueId, assetId) =>
  api(`/api/issues/${issueId}/assets/${assetId}`, { method: 'DELETE' })

export const ASSET_STATUSES = ['active', 'inactive', 'maintenance', 'retired']
