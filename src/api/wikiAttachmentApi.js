import { api } from './client'

/*
 * JL-120→124 — attachments on a Confluence Lite page.
 *
 * Uploads are base64-over-JSON, matching issue attachments (JL-33) — which is
 * why express.json carries a 25mb limit. No multer, no second upload path.
 *
 * Downloads deliberately do NOT go through api(): that helper always parses
 * JSON, and these are bytes. A raw fetch with the Bearer header is the same
 * approach the CSV export and issue attachment download already take.
 */

const TOKEN_KEY = 'jira_auth_token'

function authHeader() {
  try {
    const token = window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY)
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    // Storage can throw outright (private windows, blocked site data).
    return {}
  }
}

export const fetchPageAttachments = (pageId) =>
  api(`/api/wiki/${pageId}/attachments`)

/** `data` is base64 WITHOUT the data: URI prefix. */
export const uploadPageAttachment = (pageId, { filename, mimeType, data }) =>
  api(`/api/wiki/${pageId}/attachments`, {
    method: 'POST',
    body: JSON.stringify({ filename, mimeType, data }),
  })

export const deletePageAttachment = (pageId, attachmentId) =>
  api(`/api/wiki/${pageId}/attachments/${attachmentId}`, { method: 'DELETE' })

/**
 * The download URL. Server-gated by the page, and it streams through the API
 * rather than exposing the object store — a bare storage URL is a capability
 * that outlives the permission that granted it.
 */
export const attachmentDownloadUrl = (pageId, attachmentId) =>
  `/api/wiki/${pageId}/attachments/${attachmentId}/download`

/**
 * Fetch the bytes and hand the browser a save. Used rather than a plain link
 * because the endpoint needs the Bearer header, which an <a href> cannot send.
 */
export async function downloadPageAttachment(pageId, attachmentId, filename) {
  const res = await fetch(attachmentDownloadUrl(pageId, attachmentId), { headers: authHeader() })
  if (!res.ok) {
    const payload = await res.json().catch(() => null)
    throw new Error(payload?.error || 'Could not download that file')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'download'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking is what releases the blob; without it the bytes stay in memory
  // for the life of the document.
  URL.revokeObjectURL(url)
}

/** Read a File into the base64 the upload endpoint expects. */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // FileReader gives "data:<mime>;base64,<payload>"; the endpoint wants
      // only the payload.
      const result = String(reader.result || '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error || new Error('Could not read that file'))
    reader.readAsDataURL(file)
  })
}
