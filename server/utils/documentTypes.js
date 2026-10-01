import { MAX_DOCUMENT_BYTES } from '../config.js'

/*
 * JL-164 — what the Document Store accepts, and what it will show inline.
 *
 * A module of its own because both the route and the upload middleware need
 * it, and having the middleware import from the route made a cycle: the route
 * imports the middleware to mount it. Neither is the natural owner of a list
 * of file extensions, so neither owns it.
 */

/* ---------------------------------------------------------------- *
 * Accepted types (spec section 2)
 * ---------------------------------------------------------------- */

export const DOCUMENT_EXTENSIONS = new Set([
  // documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'md',
  // images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
  // archives
  'zip', '7z',
  // data / ops
  'json', 'xml', 'yaml', 'yml', 'sql', 'log',
])

export const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'text/markdown', 'text/xml', 'text/yaml',
  'application/rtf', 'text/rtf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/zip', 'application/x-zip-compressed', 'application/x-7z-compressed',
  'application/json', 'application/xml', 'application/x-yaml', 'application/yaml',
  'application/sql', 'text/x-sql', 'application/x-sql',
  // Clients disagree about several of these; the extension allowlist is the
  // real gate, so accepting the common spellings costs nothing.
  'text/yml', 'application/x-yml', 'text/x-log', 'application/x-rtf',
  // Browsers send this for plenty of the above; the extension check still runs.
  'application/octet-stream',
])

/*
 * Spec section 3, verbatim. A FUNCTION of the cap actually enforced, not of
 * the global default: a Space may carry its own lower max_document_bytes, and
 * a refusal that quotes 100 MB while enforcing 2 MB tells the user to do
 * something that will fail again.
 */
export const oversizeMessageFor = (maxBytes) =>
  `File size exceeds the maximum allowed limit of ${Math.round(maxBytes / (1024 * 1024))} MB. `
  + 'Please select a smaller file.'

/** The default-cap wording, for the UI and for tests. */
export const OVERSIZE_MESSAGE = oversizeMessageFor(MAX_DOCUMENT_BYTES)

/* ---------------------------------------------------------------- *
 * Preview (spec section 9)
 * ---------------------------------------------------------------- */

/*
 * Deliberately narrower than the upload allowlist. An SVG or an HTML-ish file
 * served inline on this origin executes with the app's cookies — stored XSS —
 * so SVG uploads fine and previews as a download. The inline response also
 * carries a sandbox CSP and nosniff, so even a mislabelled body cannot script.
 */
const INLINE_IMAGE_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])
const INLINE_TEXT_TYPES = new Set(['txt', 'csv', 'json', 'xml', 'yaml', 'yml', 'log', 'md', 'sql'])

export function previewKind(extension) {
  const ext = String(extension || '').toLowerCase()
  if (INLINE_IMAGE_TYPES.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (INLINE_TEXT_TYPES.has(ext)) return 'text'
  return null
}

export { INLINE_IMAGE_TYPES, INLINE_TEXT_TYPES }
