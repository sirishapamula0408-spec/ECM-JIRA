import { api } from './client'

/*
 * JL-125→127 — page templates.
 *
 * Listing is open to anyone who can read the wiki: you cannot start a page
 * from a template you cannot see. Creating, editing and deleting is Admin —
 * a template is a structure the whole team inherits.
 */

export const fetchWikiTemplates = () => api('/api/wiki-templates')

export const fetchWikiTemplate = (id) => api(`/api/wiki-templates/${id}`)

export const createWikiTemplate = (payload) =>
  api('/api/wiki-templates', { method: 'POST', body: JSON.stringify(payload) })

export const updateWikiTemplate = (id, fields) =>
  api(`/api/wiki-templates/${id}`, { method: 'PATCH', body: JSON.stringify(fields) })

/** Built-ins are refused (409) — they would return on the next restart. */
export const deleteWikiTemplate = (id) =>
  api(`/api/wiki-templates/${id}`, { method: 'DELETE' })
