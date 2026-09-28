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

// issueRef may be a numeric issue id or an issue key string like "ECM-12" (JL-301)
export const linkIssueToWiki = (pageId, issueRef) => {
  const ref = String(issueRef).trim()
  const body = /^\d+$/.test(ref) ? { issueId: Number(ref) } : { issueKey: ref }
  return api(`/api/wiki/${pageId}/link-issue`, { method: 'POST', body: JSON.stringify(body) })
}

export const unlinkIssueFromWiki = (pageId, issueId) =>
  api(`/api/wiki/${pageId}/link-issue/${issueId}`, { method: 'DELETE' })

/*
 * JL-108 — restore a previous version.
 *
 * The server APPENDS a new version carrying the old content rather than
 * rewinding, so a restore is itself undoable and the history stays immutable
 * (JL-141). Returns the updated page plus `restoredFrom`.
 */
export const restoreWikiVersion = (pageId, versionId) =>
  api(`/api/wiki/${pageId}/versions/${versionId}/restore`, { method: 'POST' })

/**
 * JL-109 — compare two versions, BY VERSION NUMBER (not row id).
 *
 * Version numbers are what the history list shows the reader, so they are what
 * the URL carries; the row ids are an implementation detail.
 */
export const compareWikiVersions = (pageId, from, to) =>
  api(`/api/wiki/${pageId}/versions/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
