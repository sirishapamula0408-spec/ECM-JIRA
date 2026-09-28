import { api } from './client'

/*
 * JL-115→119 — comments on a Confluence Lite page.
 *
 * Every endpoint inherits the page's visibility server-side: comments on a
 * page the caller cannot read are as much a disclosure as the page itself.
 *
 * Repo convention: client.js does NOT auto-stringify, so bodies go through
 * JSON.stringify here.
 */

export const fetchPageComments = (pageId) =>
  api(`/api/wiki/${pageId}/comments`)

/** `parentId` makes it a reply; threads are one level deep server-side. */
export const addPageComment = (pageId, body, parentId = null) =>
  api(`/api/wiki/${pageId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, parentId }),
  })

/** Author only — an admin editing another person's words is a misattribution. */
export const editPageComment = (pageId, commentId, body) =>
  api(`/api/wiki/${pageId}/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  })

/** Author or workspace admin. Replies cascade with their root. */
export const deletePageComment = (pageId, commentId) =>
  api(`/api/wiki/${pageId}/comments/${commentId}`, { method: 'DELETE' })

/** Roots only — resolution is a property of the thread, not of one message. */
export const resolvePageComment = (pageId, commentId, resolved = true) =>
  api(`/api/wiki/${pageId}/comments/${commentId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolved }),
  })
