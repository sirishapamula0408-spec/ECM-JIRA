import { api } from './client.js'

// --- Categories ---
export const fetchKbCategories = () =>
  api('/api/kb/categories')

export const createKbCategory = (data) =>
  api('/api/kb/categories', { method: 'POST', body: JSON.stringify(data) })

export const updateKbCategory = (id, data) =>
  api(`/api/kb/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deleteKbCategory = (id) =>
  api(`/api/kb/categories/${id}`, { method: 'DELETE' })

// --- Articles (authoring) ---
export const fetchKbArticles = ({ search, status, category } = {}) => {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (status) params.set('status', status)
  if (category) params.set('category', category)
  const qs = params.toString()
  return api(`/api/kb/articles${qs ? `?${qs}` : ''}`)
}

export const fetchKbArticle = (id) =>
  api(`/api/kb/articles/${id}`)

export const createKbArticle = (data) =>
  api('/api/kb/articles', { method: 'POST', body: JSON.stringify(data) })

export const updateKbArticle = (id, data) =>
  api(`/api/kb/articles/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deleteKbArticle = (id) =>
  api(`/api/kb/articles/${id}`, { method: 'DELETE' })

// --- Public (customer-facing) read view ---
export const fetchPublicKbArticles = ({ search, category } = {}) => {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (category) params.set('category', category)
  const qs = params.toString()
  return api(`/api/kb/public/articles${qs ? `?${qs}` : ''}`)
}

export const fetchPublicKbArticle = (slug) =>
  api(`/api/kb/public/articles/${slug}`)
