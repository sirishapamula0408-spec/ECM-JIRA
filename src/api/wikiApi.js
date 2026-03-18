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

export const searchWikiPages = (query, projectId) => {
  const params = new URLSearchParams({ q: query })
  if (projectId) params.set('projectId', projectId)
  return api(`/api/wiki/search?${params}`)
}

export const fetchWikiVersions = (pageId) =>
  api(`/api/wiki/${pageId}/versions`)

export const fetchWikiVersion = (pageId, versionId) =>
  api(`/api/wiki/${pageId}/versions/${versionId}`)

export const linkIssueToWiki = (pageId, issueId) =>
  api(`/api/wiki/${pageId}/link-issue`, { method: 'POST', body: JSON.stringify({ issueId }) })

export const unlinkIssueFromWiki = (pageId, issueId) =>
  api(`/api/wiki/${pageId}/link-issue/${issueId}`, { method: 'DELETE' })
