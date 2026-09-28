import { api } from './client'

/*
 * JL-110→114 — Confluence Lite page search.
 *
 * Separate from the Jira issue search on purpose: searching from the wiki must
 * not run a JQL query. Server-side permission filtered, the same as every
 * other wiki read — a page the caller cannot see is not findable by guessing a
 * word in it.
 *
 * Matches page titles, page content, and Space names (JL-114), so searching
 * "engineering" finds the Engineering runbooks even when no page says the word.
 */
export function searchWikiHomePages(term, { limit, spaceId, cursor } = {}) {
  const params = new URLSearchParams({ q: term })
  if (limit) params.set('limit', String(limit))
  // JL-113: narrowing is applied on top of the visibility filter server-side,
  // never instead of it, so passing a Space the caller cannot see returns
  // nothing rather than its contents.
  if (spaceId) params.set('spaceId', String(spaceId))
  if (cursor) params.set('cursor', String(cursor))
  return api(`/api/wiki-home/search?${params.toString()}`)
}
