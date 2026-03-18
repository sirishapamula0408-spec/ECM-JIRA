import { api } from './client.js'

export const fetchWikiPages = (projectId) =>
  api(`/api/wiki?projectId=${projectId}`)

export const fetchWikiPage = (id) =>
  api(`/api/wiki/${id}`)

export const createWikiPage = (data) =>
  api('/api/wiki', { method: 'POST', body: JSON.stringify(data) })

export const updateWikiPage = (id, data) =>
  api(`/api/wiki/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deleteWikiPage = (id) =>
  api(`/api/wiki/${id}`, { method: 'DELETE' })
