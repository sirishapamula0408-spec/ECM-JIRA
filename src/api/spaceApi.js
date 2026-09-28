import { api } from './client'

/*
 * JL-65 — Confluence Lite Spaces.
 *
 * A Space may be addressed by numeric id or by key (ENG), the same way JL-148
 * lets an issue be addressed either way, so callers can build a URL from what
 * a person actually types.
 *
 * Note the repo convention: client.js does NOT auto-stringify, so every body
 * is passed through JSON.stringify here.
 */

export const fetchSpaces = ({ includeArchived = false } = {}) =>
  api(`/api/spaces${includeArchived ? '?archived=true' : ''}`)

export const fetchSpace = (idOrKey) => api(`/api/spaces/${encodeURIComponent(idOrKey)}`)

export const createSpace = (payload) =>
  api('/api/spaces', { method: 'POST', body: JSON.stringify(payload) })

export const updateSpace = (idOrKey, fields) =>
  api(`/api/spaces/${encodeURIComponent(idOrKey)}`, { method: 'PATCH', body: JSON.stringify(fields) })

export const archiveSpace = (idOrKey, archived = true) =>
  updateSpace(idOrKey, { archived })

export const addSpaceMember = (idOrKey, { email, role }) =>
  api(`/api/spaces/${encodeURIComponent(idOrKey)}/members`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })

export const removeSpaceMember = (idOrKey, email) =>
  api(`/api/spaces/${encodeURIComponent(idOrKey)}/members/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  })
