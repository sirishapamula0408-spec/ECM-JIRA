import { api } from './client'

/*
 * JL-164 — the Space Document Store client.
 *
 * ── Why uploads bypass client.js ────────────────────────────────────────────
 *
 * `api()` always parses the response as JSON and never auto-stringifies a
 * body, so it is built for JSON in and JSON out. An upload is neither: the
 * body is multipart/form-data, and section 4 requires a PROGRESS bar and a
 * CANCEL button. `fetch` cannot report upload progress at all — there is no
 * equivalent of XMLHttpRequest's upload.onprogress — so the only way to meet
 * the requirement is XHR. The repo already bypasses `api()` for binary
 * downloads on the same reasoning.
 *
 * Everything that is plain JSON still goes through `api()`, so auth headers
 * and 403 handling behave exactly as they do everywhere else.
 */

const TOKEN_KEY = 'jira_auth_token'

function authHeader() {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
      || window.sessionStorage.getItem(TOKEN_KEY)
      || ''
  } catch {
    // Storage throws outright in some contexts (private windows, blocked data).
    return ''
  }
}

/* ---------------------------------------------------------------- *
 * Reads
 * ---------------------------------------------------------------- */

export function fetchDocuments(spaceIdOrKey, {
  q = '', folderId = null, fileType = '', uploadedBy = '', tag = '',
  from = '', to = '', sort = '', direction = '', limit = 25, offset = 0,
} = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (q) params.set('q', q)
  if (folderId !== null && folderId !== undefined && folderId !== '') params.set('folderId', String(folderId))
  if (fileType) params.set('fileType', fileType)
  if (uploadedBy) params.set('uploadedBy', uploadedBy)
  if (tag) params.set('tag', tag)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (sort) params.set('sort', sort)
  if (direction) params.set('direction', direction)
  return api(`/api/spaces/${encodeURIComponent(spaceIdOrKey)}/documents?${params}`)
}

export const fetchDocument = (documentId) =>
  api(`/api/documents/${encodeURIComponent(documentId)}`)

export const fetchDocumentVersions = (documentId) =>
  api(`/api/documents/${encodeURIComponent(documentId)}/versions`)

export const fetchFolders = (spaceIdOrKey) =>
  api(`/api/spaces/${encodeURIComponent(spaceIdOrKey)}/folders`)

/* ---------------------------------------------------------------- *
 * Writes (JSON)
 * ---------------------------------------------------------------- */

export const updateDocument = (documentId, fields) =>
  api(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'PUT', body: JSON.stringify(fields),
  })

export const deleteDocument = (documentId) =>
  api(`/api/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' })

export const restoreDocumentVersion = (documentId, versionId) =>
  api(`/api/documents/${encodeURIComponent(documentId)}/restore/${encodeURIComponent(versionId)}`, {
    method: 'POST',
  })

export const createFolder = (spaceIdOrKey, payload) =>
  api(`/api/spaces/${encodeURIComponent(spaceIdOrKey)}/folders`, {
    method: 'POST', body: JSON.stringify(payload),
  })

export const updateFolder = (folderId, fields) =>
  api(`/api/folders/${encodeURIComponent(folderId)}`, {
    method: 'PUT', body: JSON.stringify(fields),
  })

export const deleteFolder = (folderId) =>
  api(`/api/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' })

/* ---------------------------------------------------------------- *
 * URLs the browser fetches directly
 * ---------------------------------------------------------------- */

export const documentDownloadUrl = (documentId, versionId) =>
  `/api/documents/${encodeURIComponent(documentId)}/download${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''}`

export const documentPreviewUrl = (documentId) =>
  `/api/documents/${encodeURIComponent(documentId)}/preview`

/* ---------------------------------------------------------------- *
 * Upload — XHR, for progress and cancellation
 * ---------------------------------------------------------------- */

/**
 * Upload one document.
 *
 * @param {string|number} spaceIdOrKey
 * @param {File}    file
 * @param {object}  [opts] { folderId, description, tags, onProgress }
 * @returns {{ promise: Promise<object>, cancel: () => void }}
 *
 * Returns the cancel handle alongside the promise rather than taking an
 * AbortSignal, because XHR predates AbortController and the caller needs the
 * two together anyway — a progress bar with no cancel button is a requirement
 * half met.
 */
export function uploadDocument(spaceIdOrKey, file, {
  folderId = null, description = '', tags = '', onProgress,
} = {}) {
  const xhr = new XMLHttpRequest()
  const form = new FormData()
  // The field name the server's multer instance expects.
  form.append('file', file, file.name)
  if (folderId) form.append('folderId', String(folderId))
  if (description) form.append('description', description)
  if (tags) form.append('tags', tags)

  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', `/api/spaces/${encodeURIComponent(spaceIdOrKey)}/documents`)
    const token = authHeader()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    /*
     * Content-Type is NOT set by hand. The browser has to generate the
     * multipart boundary and put it in the header; setting the header
     * ourselves would omit the boundary and the server would fail to parse a
     * body that looks perfectly valid.
     */

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percent: Math.round((event.loaded / event.total) * 100),
          })
        }
      }
    }

    xhr.onload = () => {
      let body = null
      try { body = JSON.parse(xhr.responseText) } catch { body = null }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body)
      // The server owns the wording for every refusal — size, type, quota,
      // duplicates — so surface its message rather than inventing one here.
      const err = new Error(body?.error || `Upload failed (${xhr.status})`)
      err.status = xhr.status
      err.data = body
      return reject(err)
    }
    xhr.onerror = () => reject(new Error('Upload failed: the network connection was interrupted.'))
    xhr.onabort = () => {
      const err = new Error('Upload cancelled')
      err.cancelled = true
      reject(err)
    }
    xhr.send(form)
  })

  return { promise, cancel: () => xhr.abort() }
}

/** Replace a document, keeping the previous version. Same shape as upload. */
export function replaceDocument(documentId, file, { changeComment = '', onProgress } = {}) {
  const xhr = new XMLHttpRequest()
  const form = new FormData()
  form.append('file', file, file.name)
  if (changeComment) form.append('changeComment', changeComment)

  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', `/api/documents/${encodeURIComponent(documentId)}/versions`)
    const token = authHeader()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percent: Math.round((event.loaded / event.total) * 100),
          })
        }
      }
    }
    xhr.onload = () => {
      let body = null
      try { body = JSON.parse(xhr.responseText) } catch { body = null }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body)
      const err = new Error(body?.error || `Upload failed (${xhr.status})`)
      err.status = xhr.status
      return reject(err)
    }
    xhr.onerror = () => reject(new Error('Upload failed: the network connection was interrupted.'))
    xhr.onabort = () => {
      const err = new Error('Upload cancelled')
      err.cancelled = true
      reject(err)
    }
    xhr.send(form)
  })

  return { promise, cancel: () => xhr.abort() }
}

/** Human-readable size, used by the list and the upload dialog. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  // One decimal below 10 so "1.4 MB" stays informative, none above so a list
  // of sizes lines up.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
