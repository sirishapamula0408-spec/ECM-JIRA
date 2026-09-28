import { Router } from 'express'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { pageVisibilityFilter } from '../utils/wikiVisibility.js'
import { getStorage } from '../services/storage.js'
// JL-123: the type and size rules are the issue-attachment ones, imported
// rather than restated. A second allow-list would drift from the first the
// day either was widened, and the two would disagree about what is safe.
import { validateUpload, MAX_ATTACHMENT_BYTES } from './attachments.js'

/*
 * JL-120→124 — attachments on a Confluence Lite page.
 *
 * ── What is shared, and what is not ─────────────────────────────────────────
 *
 * The TABLE is separate from `attachments` (whose issue_id is NOT NULL), for
 * the same reason page comments are separate from issue comments: widening it
 * would force every existing issue query to start excluding page rows.
 *
 * The MACHINERY is shared outright — validateUpload for type and size, and
 * getStorage() for the object store. The duplication worth avoiding is the
 * logic, not the foreign key.
 *
 * ── JL-122: serving is gated by the PAGE ────────────────────────────────────
 *
 * An attachment is as readable as the page it hangs on. Every route here
 * resolves the page through the same pageVisibilityFilter as the rest of
 * Confluence Lite, and the download streams through this process rather than
 * handing out a URL to the object store — a bare storage URL is a capability
 * that outlives the permission that granted it.
 */

const router = Router()

/** Columns every response carries. Never SELECT *. */
const ATTACHMENT_COLUMNS =
  'id, page_id, filename, mime_type, size_bytes, uploaded_by, created_at'

/** The page, if this caller may see it. Null means 404, never 403. */
async function visiblePage(pageId, user) {
  if (!Number.isInteger(pageId) || pageId <= 0) return null
  const vis = await pageVisibilityFilter(user, 'w')
  return get(
    `SELECT w.id FROM wiki_pages w WHERE w.id = ? AND ${vis.clause}`,
    [pageId, ...vis.params],
  )
}

/** True when this user may remove someone else's upload (JL-124). */
function isModerator(user) {
  const role = String(user?.workspaceRole || '')
  return role === 'Admin' || role === 'Owner' || user?.isOwner === true
}

const sameUser = (a, b) =>
  String(a || '').toLowerCase() === String(b || '').toLowerCase()

/* ---------------------------------------------------------------- *
 * JL-121 — list what is attached
 * ---------------------------------------------------------------- */
router.get('/:id/attachments', asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  if (!await visiblePage(pageId, req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }
  const rows = await all(
    `SELECT ${ATTACHMENT_COLUMNS} FROM wiki_page_attachments WHERE page_id = ? ORDER BY created_at DESC`,
    [pageId],
  )
  // storage_path is deliberately absent: it is the object key, and a client
  // that never sees it cannot be tempted to fetch around this endpoint.
  res.json(rows)
}))

/* ---------------------------------------------------------------- *
 * JL-120 / JL-123 — upload
 * ---------------------------------------------------------------- */
router.post('/:id/attachments', requireRole('Member'), asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  if (!await visiblePage(pageId, req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }

  const { filename, mimeType, data } = req.body || {}
  if (!filename || !data) {
    res.status(400).json({ error: 'filename and data are required' })
    return
  }

  /*
   * JL-123. Validated BEFORE the base64 is decoded: estimateBase64Bytes reads
   * the size from the string length, so an oversized upload is refused without
   * first allocating it in memory. Deciding after decoding would mean the
   * rejection path was the expensive one.
   */
  const problem = validateUpload({ filename, mime: mimeType, dataBase64: data })
  if (problem) {
    res.status(problem.status || 400).json({ error: problem.error })
    return
  }

  const buffer = Buffer.from(data, 'base64')
  // The estimate is deliberately re-checked against the real length: the
  // estimate is an upper bound on a well-formed string, and a malformed one
  // should not be able to slip past it.
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    res.status(413).json({
      error: `File is too large. Maximum allowed size is ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`,
    })
    return
  }

  /*
   * The stored key is a UUID, never the uploaded filename. A user-supplied
   * name in a path is a traversal waiting to happen, and two people uploading
   * "notes.pdf" must not collide. The original name is kept as data, which is
   * where it belongs.
   */
  const key = `wiki-${pageId}-${randomUUID()}${path.extname(filename).slice(0, 12)}`
  const storage = getStorage()
  await storage.put(key, buffer, mimeType)

  const created = await run(
    `INSERT INTO wiki_page_attachments
       (page_id, filename, mime_type, size_bytes, storage_path, storage_backend, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [pageId, filename, mimeType || null, buffer.length, key, storage.backend || 'local', req.user.email],
  )
  const row = await get(
    `SELECT ${ATTACHMENT_COLUMNS} FROM wiki_page_attachments WHERE id = ?`,
    [created.lastID],
  )
  res.status(201).json(row)
}))

/* ---------------------------------------------------------------- *
 * JL-122 — download, gated by the page
 * ---------------------------------------------------------------- */
router.get('/:id/attachments/:attachmentId/download', asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  if (!await visiblePage(pageId, req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }

  const row = await get(
    'SELECT * FROM wiki_page_attachments WHERE id = ? AND page_id = ?',
    [Number(req.params.attachmentId), pageId],
  )
  if (!row) {
    res.status(404).json({ error: 'Attachment not found' })
    return
  }

  const storage = getStorage()
  try {
    const buffer = await storage.get(path.basename(row.storage_path))
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream')
    /*
     * `attachment`, not `inline`: an uploaded HTML or SVG file rendered inline
     * on this origin would execute with the app's cookies. Forcing a download
     * means the browser never treats stored content as same-origin script.
     * The quote strip keeps the filename from breaking out of the header.
     */
    res.setHeader('Content-Disposition', `attachment; filename="${String(row.filename).replace(/"/g, '')}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(buffer)
  } catch {
    // The row survives an object that has gone missing; saying so beats a 500.
    res.status(404).json({ error: 'That file is no longer stored' })
  }
}))

/* ---------------------------------------------------------------- *
 * JL-124 — delete
 * ---------------------------------------------------------------- */
router.delete('/:id/attachments/:attachmentId', requireRole('Member'), asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  if (!await visiblePage(pageId, req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }

  const row = await get(
    'SELECT * FROM wiki_page_attachments WHERE id = ? AND page_id = ?',
    [Number(req.params.attachmentId), pageId],
  )
  if (!row) {
    res.status(404).json({ error: 'Attachment not found' })
    return
  }

  if (!sameUser(row.uploaded_by, req.user.email) && !isModerator(req.user)) {
    res.status(403).json({ error: 'Only the uploader or an admin can delete an attachment' })
    return
  }

  /*
   * The row goes first, the object second. The other order would leave a row
   * pointing at nothing if the delete failed in between — a listing entry that
   * 404s on download. This way the worst case is an orphaned object, which
   * costs disk rather than lying to the reader.
   */
  await run('DELETE FROM wiki_page_attachments WHERE id = ?', [row.id])
  await getStorage().remove(path.basename(row.storage_path))

  res.json({ success: true })
}))

export default router
