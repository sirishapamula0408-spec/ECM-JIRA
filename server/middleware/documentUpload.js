import multer from 'multer'
import os from 'node:os'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { MAX_DOCUMENT_BYTES } from '../config.js'
import { oversizeMessageFor } from '../routes/documents.js'

/*
 * JL-164 — multipart upload for the Document Store.
 *
 * ── Why multipart here and base64-over-JSON for attachments ─────────────────
 *
 * Issue and page attachments are capped at 10 MB and ride in a JSON body,
 * which is simple and needs no dependency. The Document Store accepts 100 MB.
 * Base64 inflates that by a third, so the same approach would mean a ~134 MB
 * JSON body buffered in memory, and the global express.json limit raised for
 * EVERY endpoint in the app to allow it — a denial-of-service lever handed out
 * for the sake of two routes.
 *
 * Multipart bodies never reach express.json at all, so the global 25mb limit
 * is untouched. The existing attachment endpoints are deliberately NOT
 * converted: they work, they are covered by JL-33/JL-71/JL-120, and churning
 * them buys nothing.
 *
 * ── Disk, not memory ────────────────────────────────────────────────────────
 *
 * multer.memoryStorage() would put the whole 100 MB on the heap, which is the
 * problem this design exists to avoid. Files land in a temp directory and are
 * streamed into the storage backend, then removed — on success, on rejection,
 * and on error. A leaked 100 MB temp file per failed upload is its own bug.
 */

export const TEMP_DIR = path.join(os.tmpdir(), 'ecm-document-uploads')

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fsp.mkdir(TEMP_DIR, { recursive: true })
      .then(() => cb(null, TEMP_DIR))
      .catch(cb)
  },
  /*
   * A UUID, never the client's filename. multer writes this straight to disk,
   * so a name containing "../" or a NUL byte would be a path traversal at the
   * moment of writing — before any of our validation has run.
   */
  filename: (_req, _file, cb) => cb(null, `upload-${randomUUID()}.tmp`),
})

/**
 * Strip everything path-like out of a client-supplied filename.
 *
 * The result is used as DATA (the display name), never as a path — the stored
 * object key is generated separately — but a name carrying separators would
 * still be wrong in a Content-Disposition header and misleading in the UI.
 */
export function safeDisplayName(raw) {
  const name = String(raw || '')
    .replace(/\0/g, '')          // NUL truncation tricks
    .replace(/[\\/]/g, '_')      // both separators, on every platform
    .replace(/^\.+/, '')         // leading dots, so "..", "..." cannot survive
    .trim()
  // basename() is belt as well as braces once separators are gone.
  const base = path.basename(name)
  return base.slice(0, 255) || 'unnamed'
}

/*
 * The size cap lives in the PARSER, so an oversized body is cut off as it
 * arrives rather than after 100 MB has been written to disk. `files: 1`
 * because the API takes one document per request; the UI sends several
 * requests for a multi-file selection, which also gives it per-file progress
 * and per-file cancellation.
 */
const upload = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 20 },
}).single('file')

/** Remove a temp file, ignoring the case where it is already gone. */
export async function cleanupTemp(file) {
  if (!file?.path) return
  await fsp.unlink(file.path).catch(() => {})
}

/**
 * Express middleware: parse one multipart file upload.
 *
 * Translates multer's own failures into the product's wording, and guarantees
 * the temp file is removed on every failure path. On success the handler owns
 * the file and must clean it up itself — see withTempCleanup below.
 */
export function documentUpload(req, res, next) {
  upload(req, res, async (err) => {
    if (!err) return next()

    await cleanupTemp(req.file)

    if (err.code === 'LIMIT_FILE_SIZE') {
      // Spec section 3, and the limit comes from configuration rather than a
      // literal so raising MAX_DOCUMENT_SIZE_MB changes the message too.
      return res.status(413).json({ error: oversizeMessageFor(MAX_DOCUMENT_BYTES) })
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Upload one file per request, in a field named "file".' })
    }
    return res.status(400).json({ error: `Upload failed: ${err.message}` })
  })
}

/**
 * Guarantee the temp file is gone once the handler has finished with it,
 * whether it succeeded, returned a rejection, or threw.
 */
export async function withTempCleanup(req, handler) {
  try {
    return await handler()
  } finally {
    await cleanupTemp(req.file)
  }
}
