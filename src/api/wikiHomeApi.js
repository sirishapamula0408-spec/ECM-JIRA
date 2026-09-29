import { api } from './client'

/*
 * JL-152 — Confluence Lite home page.
 *
 * Two reads, deliberately: `fetchWikiHome` returns everything the sidebar and
 * the card grid need in one round trip, and `fetchWikiFeed` is separate so a
 * slow feed cannot hold up the grid. Both constraints come straight from the
 * brief and they pull against each other; two requests is the floor.
 *
 * Repo convention: client.js does NOT auto-stringify, so bodies are passed
 * through JSON.stringify here.
 */

export const fetchWikiHome = () => api('/api/wiki-home')

export function fetchWikiFeed({ tab = 'following', sort = 'relevant', cursor = 0, limit } = {}) {
  const params = new URLSearchParams({ tab, sort, cursor: String(cursor) })
  if (limit) params.set('limit', String(limit))
  return api(`/api/wiki-home/feed?${params.toString()}`)
}

/** Record that the caller read a page. Fire-and-forget at the call site. */
export const recordPageView = (pageId) =>
  api(`/api/wiki-home/views/${encodeURIComponent(pageId)}`, { method: 'POST' })

export const addFavorite = (targetType, targetId) =>
  api('/api/wiki-home/favorites', {
    method: 'POST',
    body: JSON.stringify({ targetType, targetId }),
  })

export const removeFavorite = (targetType, targetId) =>
  api(`/api/wiki-home/favorites/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`, {
    method: 'DELETE',
  })

/**
 * The paginated form of the sidebar's Recent / Starred lists — what its
 * "Show more" link opens. Same permission filter as every other read.
 */
export function fetchWikiList({ kind = 'recent', cursor = 0, limit, spaceId } = {}) {
  const params = new URLSearchParams({ kind, cursor: String(cursor) })
  if (limit) params.set('limit', String(limit))
  /*
   * JL-162 - spaceId narrows to one Space, and only 'modified' honours it:
   * 'recent' and 'starred' are about the READER, not the Space. The server
   * applies it on top of the visibility filter, never instead, so a Space the
   * caller cannot see yields nothing rather than its pages.
   */
  if (spaceId) params.set('spaceId', String(spaceId))
  return api(`/api/wiki-home/list?${params.toString()}`)
}
