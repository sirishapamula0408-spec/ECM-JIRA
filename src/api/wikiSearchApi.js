import { api } from './client'

/*
 * JL-153 — Confluence Lite page search.
 *
 * Separate from the Jira issue search on purpose: searching from the wiki must
 * not run a JQL query. Server-side permission filtered, the same as every
 * other wiki-home read.
 */
export function searchWikiHomePages(term, { limit } = {}) {
  const params = new URLSearchParams({ q: term })
  if (limit) params.set('limit', String(limit))
  return api(`/api/wiki-home/search?${params.toString()}`)
}
