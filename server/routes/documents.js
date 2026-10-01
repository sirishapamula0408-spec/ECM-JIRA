import { Router } from 'express'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { getStorage } from '../services/storage.js'
import { scanBuffer } from '../services/virusScan.js'
import { safeAppendAudit } from '../services/auditLog.js'
import { maxLengthError } from '../utils/validation.js'
import { validateUpload } from './attachments.js'
import { resolveSpaceRole, spaceRoleAtLeast } from './spaces.js'
import { MAX_DOCUMENT_BYTES, SPACE_STORAGE_LIMIT_BYTES } from '../config.js'
import {
  DOCUMENT_EXTENSIONS, DOCUMENT_MIME_TYPES, oversizeMessageFor, previewKind,
} from '../utils/documentTypes.js'
import { signatureMismatch } from '../utils/fileSignature.js'
import { documentUpload, withTempCleanup, safeDisplayName } from '../middleware/documentUpload.js'

/*
 * JL-164 — the Space Document Store.
 *
 * ── Why this is not wiki_page_attachments ───────────────────────────────────
 *
 * An attachment hangs off a PAGE and dies with it. A document belongs to a
 * SPACE, outlives every page in it, and carries folders, versions, tags and a
 * lifecycle of its own. Widening the attachment table to serve both would mean
 * a nullable page_id, a CHECK that exactly one owner is set, and every existing
 * attachment query rewritten to exclude documents.
 *
 * ── Permissions (spec section 11) ───────────────────────────────────────────
 *
 * Mapped onto the Space roles that already exist rather than inventing a
 * second vocabulary. The spec's "Editor" IS a Space Member:
 *
 *   Viewer   view, download
 *   Member   + upload, replace, edit metadata          (spec: Editor)
 *   Admin    + move, delete, restore a version         (spec: Space Admin)
 *
 * A Space the caller cannot see is 404, never 403 — saying a Space exists but
 * is closed to you is itself a disclosure, and that is the rule everywhere
 * else in Confluence Lite.
 *
 * ── Storage (spec section 14) ───────────────────────────────────────────────
 *
 * Bytes go to services/storage.js (local disk, or S3 when configured);
 * PostgreSQL holds metadata only. The stored key is a UUID, never the uploaded
 * filename: a user-supplied name in a path is a traversal waiting to happen,
 * and two people uploading "notes.pdf" must not collide.
 */

const router = Router()

/*
 * The accepted types, the size wording and the preview rules live in
 * utils/documentTypes.js — the upload middleware needs them too, and importing
 * them from here would make a cycle, since this module imports that middleware.
 */
export {
  DOCUMENT_EXTENSIONS, DOCUMENT_MIME_TYPES, oversizeMessageFor, previewKind,
} from '../utils/documentTypes.js'

/*
 * How much of a file is read for sniffing and scanning. Bounded on purpose:
 * pulling a 100 MB upload onto the heap to inspect it would defeat streaming.
 */
const HEAD_BYTES = 8 * 1024

const NAME_MAX = 255
const DESCRIPTION_MAX = 2000
const TAGS_MAX = 500
const PAGE_SIZE_DEFAULT = 25
const PAGE_SIZE_MAX = 100

const DOCUMENT_COLUMNS = `
  d.id, d.space_id, d.folder_id, d.file_name, d.original_file_name,
  d.file_extension, d.mime_type, d.file_size, d.description, d.tags,
  d.uploaded_by, d.uploaded_at, d.updated_by, d.updated_at,
  d.current_version, d.status`

/* ---------------------------------------------------------------- *
 * Shared guards
 * ---------------------------------------------------------------- */

/** Load a Space by id or key and resolve the caller's role in it. */
async function loadSpace(idOrKey, user) {
  const value = String(idOrKey ?? '').trim()
  const space = /^\d+$/.test(value)
    ? await get('SELECT id, key, name, owner_email, archived, storage_limit_bytes, max_document_bytes FROM spaces WHERE id = ?', [Number(value)])
    : await get('SELECT id, key, name, owner_email, archived, storage_limit_bytes, max_document_bytes FROM spaces WHERE LOWER(key) = LOWER(?)', [value])
  if (!space) return null
  const role = await resolveSpaceRole(space, user)
  return role ? { space, role } : null
}

/**
 * Load a document and the caller's role in its Space.
 * Returns null when the document is missing, deleted, or its Space is closed
 * to the caller — all of which the caller must see as the same 404.
 */
async function loadDocument(documentId, user) {
  const doc = await get(
    'SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL',
    [Number(documentId)],
  )
  if (!doc) return null
  const found = await loadSpace(doc.space_id, user)
  if (!found) return null
  return { doc, space: found.space, role: found.role }
}

/** The per-file cap for a Space: its own override, else the server default. */
const fileCapFor = (space) => Number(space?.max_document_bytes) || MAX_DOCUMENT_BYTES
/** The total storage cap for a Space: its own override, else the default. */
const quotaFor = (space) => Number(space?.storage_limit_bytes) || SPACE_STORAGE_LIMIT_BYTES

/**
 * Bytes currently held by a Space.
 *
 * Counts live documents AND every retained version, because a superseded
 * version still occupies storage — charging only for the current version
 * would let a Space grow without limit by replacing one file repeatedly.
 */
async function usedBytes(spaceId) {
  const row = await get(
    `SELECT
       COALESCE((SELECT SUM(file_size) FROM documents
                  WHERE space_id = ? AND deleted_at IS NULL), 0)
     + COALESCE((SELECT SUM(v.file_size) FROM document_versions v
                  JOIN documents d ON d.id = v.document_id
                 WHERE d.space_id = ? AND d.deleted_at IS NULL
                   AND v.version_number <> d.current_version), 0) AS used`,
    [Number(spaceId), Number(spaceId)],
  )
  return Number(row?.used || 0)
}

const notFound = (res, what = 'Document') => res.status(404).json({ error: `${what} not found` })

/**
 * Validate a multipart upload and stream it into the storage backend.
 *
 * Everything that can refuse the file runs BEFORE a single byte is copied
 * into permanent storage: extension, executable denylist, MIME, size, magic
 * bytes, quota and the virus scan. The temp file on disk is the caller's to
 * clean up (withTempCleanup), whichever way this returns.
 *
 * @param {object} o { space, file (multer), currentBytes }
 */
async function acceptUpload({ space, file, currentBytes }) {
  const displayName = safeDisplayName(file.originalname)
  const cap = fileCapFor(space)

  /*
   * The shared validator, with the Document Store's wider allowlist and
   * larger cap. dataBase64 is omitted deliberately — multer already enforced
   * the size limit as the body arrived, and file.size is the real figure, so
   * re-deriving it from a base64 string we no longer have would be worse than
   * useless. The explicit size check below covers it.
   */
  const problem = validateUpload(
    { filename: displayName, mime: file.mimetype, dataBase64: '' },
    {
      extensions: DOCUMENT_EXTENSIONS,
      mimeTypes: DOCUMENT_MIME_TYPES,
      maxBytes: cap,
      oversizeMessage: oversizeMessageFor(cap),
    },
  )
  if (problem) return { error: problem }

  /*
   * multer's limit is the SERVER default; a Space may impose a lower one, and
   * that cannot be known until the Space has been loaded — which happens after
   * the body has been parsed. So the per-Space cap is enforced here.
   */
  if (file.size > cap) {
    return { error: { status: 413, error: oversizeMessageFor(cap) } }
  }

  const quota = quotaFor(space)
  if (currentBytes + file.size > quota) {
    const gb = (quota / (1024 * 1024 * 1024)).toFixed(0)
    return {
      error: {
        status: 507,
        error: `This Space has reached its ${gb} GB storage limit. Delete documents or ask an admin to raise the limit.`,
      },
    }
  }

  const ext = displayName.split('.').pop().toLowerCase()

  /*
   * Section 12: never trust the extension alone. With multipart both the
   * filename and the Content-Type are client-supplied strings, so the leading
   * bytes are the only part of the upload that cannot simply be relabelled.
   * Only the head is read — sniffing costs 16 bytes, not the file.
   */
  /*
   * HEAD_BYTES, not the whole file: sniffing and scanning must not undo the
   * point of streaming by pulling 100 MB back onto the heap. 8 KiB is far
   * more than any signature needs and comfortably contains the EICAR string.
   */
  let head
  try {
    const handle = await fsp.open(file.path, 'r')
    try {
      const buf = Buffer.alloc(HEAD_BYTES)
      const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0)
      head = buf.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  } catch (err) {
    /*
     * An unreadable temp file is a failed upload, not a crash.
     *
     * This is a real case rather than a defensive flourish: an anti-virus
     * product on the host locks or quarantines a malicious file the moment it
     * is written to disk, so the read fails with EPERM before our own scanner
     * ever sees it. Observed on Windows with Defender active, using the EICAR
     * test file. Treating it as a rejection means host AV and the in-process
     * hook produce the same answer instead of a 500.
     */
    return {
      error: {
        status: 422,
        error: 'Upload rejected: the file could not be read for scanning. '
          + 'It may have been quarantined by anti-virus software.',
        cause: err.code || 'EREAD',
      },
    }
  }

  const mismatch = signatureMismatch(head.subarray(0, 16), ext)
  if (mismatch) return { error: { status: 415, error: mismatch } }

  /*
   * The malware hook (services/virusScan.js) takes a Buffer. Only the head is
   * scanned, which catches signatures that sit at the start of a file — the
   * EICAR case, and most real ones. A clamd integration would stream the whole
   * file to the daemon instead; that is the note for whoever wires one up.
   */
  const scan = await scanBuffer(head)
  if (!scan.clean) {
    return { error: { status: 422, error: `Upload rejected: ${scan.reason || 'malware detected'}` } }
  }

  /*
   * The stored key is a UUID. A user-supplied name in a path is a traversal
   * waiting to happen, and two people uploading "notes.pdf" must not collide.
   * The display name is kept as data, which is where it belongs.
   */
  const key = `doc-${space.id}-${randomUUID()}.${ext}`
  const storage = getStorage()
  if (typeof storage.putStream === 'function') {
    await storage.putStream(key, createReadStream(file.path), file.mimetype, file.size)
  } else {
    // A backend without streaming support still works, at the cost of the heap.
    await storage.put(key, await fsp.readFile(file.path), file.mimetype)
  }

  return { key, ext, size: file.size, backend: storage.backend || 'local', displayName }
}

/* ================================================================
   Folders — declared before /documents/:id so no literal segment
   is ever captured by a parameter (the repo has been bitten by
   route ordering three times: JL-68, JL-99).
   ================================================================ */

/** POST /api/spaces/:spaceId/folders — create a folder. */
router.post('/spaces/:spaceId/folders', asyncHandler(async (req, res) => {
  const found = await loadSpace(req.params.spaceId, req.user)
  if (!found) return notFound(res, 'Space')
  if (!spaceRoleAtLeast(found.role, 'Member')) {
    return res.status(403).json({ error: 'You do not have permission to create folders in this Space' })
  }

  const folderName = String(req.body?.folderName || req.body?.name || '').trim()
  if (!folderName) return res.status(400).json({ error: 'folderName is required' })
  const lengthErr = maxLengthError('folderName', folderName, NAME_MAX)
  if (lengthErr) return res.status(400).json({ error: lengthErr })

  const parentId = req.body?.parentFolderId ? Number(req.body.parentFolderId) : null
  if (parentId) {
    const parent = await get(
      'SELECT id FROM document_folders WHERE id = ? AND space_id = ?',
      [parentId, found.space.id],
    )
    // A parent in another Space would file this folder outside the Space the
    // caller was authorised for.
    if (!parent) return res.status(400).json({ error: 'Parent folder not found in this Space' })
  }

  const clash = await get(
    parentId
      ? 'SELECT id FROM document_folders WHERE space_id = ? AND parent_folder_id = ? AND LOWER(folder_name) = LOWER(?)'
      : 'SELECT id FROM document_folders WHERE space_id = ? AND parent_folder_id IS NULL AND LOWER(folder_name) = LOWER(?)',
    parentId ? [found.space.id, parentId, folderName] : [found.space.id, folderName],
  )
  if (clash) return res.status(409).json({ error: `A folder named "${folderName}" already exists here` })

  const created = await run(
    'INSERT INTO document_folders (space_id, parent_folder_id, folder_name, created_by) VALUES (?, ?, ?, ?)',
    [found.space.id, parentId, folderName, req.user.email],
  )
  safeAppendAudit({
    actor: req.user.email,
    action: 'document.folder.created',
    target: `folder:${created.lastID}`,
    metadata: { spaceId: found.space.id, folderName },
  })
  const row = await get('SELECT * FROM document_folders WHERE id = ?', [created.lastID])
  res.status(201).json(row)
}))

/** GET /api/spaces/:spaceId/folders — the folder tree for a Space. */
router.get('/spaces/:spaceId/folders', asyncHandler(async (req, res) => {
  const found = await loadSpace(req.params.spaceId, req.user)
  if (!found) return notFound(res, 'Space')
  const rows = await all(
    'SELECT * FROM document_folders WHERE space_id = ? ORDER BY folder_name ASC',
    [found.space.id],
  )
  res.json(rows)
}))

/** PUT /api/folders/:folderId — rename or move a folder. */
router.put('/folders/:folderId', asyncHandler(async (req, res) => {
  const folder = await get('SELECT * FROM document_folders WHERE id = ?', [Number(req.params.folderId)])
  if (!folder) return notFound(res, 'Folder')
  const found = await loadSpace(folder.space_id, req.user)
  if (!found) return notFound(res, 'Folder')
  if (!spaceRoleAtLeast(found.role, 'Member')) {
    return res.status(403).json({ error: 'You do not have permission to change folders in this Space' })
  }

  const sets = []
  const params = []
  if (req.body?.folderName !== undefined) {
    const name = String(req.body.folderName).trim()
    if (!name) return res.status(400).json({ error: 'folderName cannot be empty' })
    const err = maxLengthError('folderName', name, NAME_MAX)
    if (err) return res.status(400).json({ error: err })
    sets.push('folder_name = ?'); params.push(name)
  }
  if (req.body?.parentFolderId !== undefined) {
    const parentId = req.body.parentFolderId ? Number(req.body.parentFolderId) : null
    if (parentId === folder.id) {
      return res.status(400).json({ error: 'A folder cannot be its own parent' })
    }
    if (parentId) {
      const parent = await get(
        'SELECT id FROM document_folders WHERE id = ? AND space_id = ?',
        [parentId, folder.space_id],
      )
      if (!parent) return res.status(400).json({ error: 'Parent folder not found in this Space' })
      // Moving a folder beneath its own descendant would detach the subtree
      // from the tree entirely and leave it unreachable.
      if (await isDescendant(parentId, folder.id)) {
        return res.status(400).json({ error: 'A folder cannot be moved inside itself' })
      }
    }
    sets.push('parent_folder_id = ?'); params.push(parentId)
  }
  if (!sets.length) return res.status(400).json({ error: 'No supported fields to update' })

  sets.push('updated_at = NOW()')
  await run(`UPDATE document_folders SET ${sets.join(', ')} WHERE id = ?`, [...params, folder.id])
  res.json(await get('SELECT * FROM document_folders WHERE id = ?', [folder.id]))
}))

/** Is `candidateId` inside the subtree rooted at `rootId`? */
async function isDescendant(candidateId, rootId) {
  let cursor = Number(candidateId)
  // Bounded rather than `while (true)`: a cycle already in the data must not
  // hang the request.
  for (let hops = 0; cursor && hops < 64; hops += 1) {
    if (cursor === Number(rootId)) return true
    const row = await get('SELECT parent_folder_id FROM document_folders WHERE id = ?', [cursor])
    cursor = row?.parent_folder_id ? Number(row.parent_folder_id) : 0
  }
  return false
}

/** DELETE /api/folders/:folderId — remove an empty folder. */
router.delete('/folders/:folderId', asyncHandler(async (req, res) => {
  const folder = await get('SELECT * FROM document_folders WHERE id = ?', [Number(req.params.folderId)])
  if (!folder) return notFound(res, 'Folder')
  const found = await loadSpace(folder.space_id, req.user)
  if (!found) return notFound(res, 'Folder')
  if (!spaceRoleAtLeast(found.role, 'Admin')) {
    return res.status(403).json({ error: 'Only a Space Admin can delete a folder' })
  }

  /*
   * Refused while it still holds anything. documents.folder_id is
   * ON DELETE SET NULL, so deleting a full folder would not delete its
   * documents — it would silently tip them back into the Space root, which is
   * neither of the outcomes the person clicking delete has in mind. Same
   * reasoning as JL-156 for Spaces that still hold pages.
   */
  const docs = await get(
    'SELECT COUNT(*)::int AS n FROM documents WHERE folder_id = ? AND deleted_at IS NULL',
    [folder.id],
  )
  if (Number(docs?.n || 0) > 0) {
    return res.status(409).json({
      error: `This folder still holds ${docs.n} document${docs.n === 1 ? '' : 's'}. Move or delete them first.`,
      documentCount: docs.n,
    })
  }
  const kids = await get(
    'SELECT COUNT(*)::int AS n FROM document_folders WHERE parent_folder_id = ?',
    [folder.id],
  )
  if (Number(kids?.n || 0) > 0) {
    return res.status(409).json({ error: 'This folder still has subfolders. Delete them first.' })
  }

  await run('DELETE FROM document_folders WHERE id = ?', [folder.id])
  safeAppendAudit({
    actor: req.user.email,
    action: 'document.folder.deleted',
    target: `folder:${folder.id}`,
    metadata: { spaceId: folder.space_id, folderName: folder.folder_name },
  })
  res.json({ ok: true, id: folder.id })
}))

/* ================================================================
   Documents
   ================================================================ */

/** GET /api/spaces/:spaceId/documents — paginated, searchable listing. */
router.get('/spaces/:spaceId/documents', asyncHandler(async (req, res) => {
  const found = await loadSpace(req.params.spaceId, req.user)
  if (!found) return notFound(res, 'Space')

  const limit = Math.min(Math.max(Number(req.query.limit) || PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX)
  const offset = Math.max(Number(req.query.offset) || 0, 0)

  const where = ['d.space_id = ?', 'd.deleted_at IS NULL']
  const params = [found.space.id]

  // Filters (section 8). Each narrows ON TOP of the Space scope above, never
  // instead of it.
  if (req.query.folderId === 'root') {
    where.push('d.folder_id IS NULL')
  } else if (req.query.folderId) {
    where.push('d.folder_id = ?'); params.push(Number(req.query.folderId))
  }
  if (req.query.fileType) {
    where.push('LOWER(d.file_extension) = LOWER(?)'); params.push(String(req.query.fileType))
  }
  if (req.query.uploadedBy) {
    where.push('LOWER(d.uploaded_by) = LOWER(?)'); params.push(String(req.query.uploadedBy))
  }
  if (req.query.from) { where.push('d.uploaded_at >= ?'); params.push(String(req.query.from)) }
  if (req.query.to) { where.push('d.uploaded_at <= ?'); params.push(String(req.query.to)) }
  if (req.query.tag) { where.push('d.tags ILIKE ?'); params.push(`%${String(req.query.tag)}%`) }

  const q = String(req.query.q || '').trim()
  if (q) {
    /*
     * Full-text over the metadata the GIN index covers, OR a plain ILIKE on
     * the name. The ILIKE arm is what makes a partial word like "requir" find
     * "Requirements.docx" — to_tsquery matches lexemes, not prefixes typed
     * mid-word, and a document search that fails on a half-typed filename
     * would be useless.
     */
    where.push(`(
      to_tsvector('english', d.file_name || ' ' || COALESCE(d.description, '') || ' ' || COALESCE(d.tags, ''))
        @@ plainto_tsquery('english', ?)
      OR d.file_name ILIKE ?
    )`)
    params.push(q, `%${q}%`)
  }

  const SORTS = {
    name: 'd.file_name', type: 'd.file_extension', size: 'd.file_size',
    uploaded: 'd.uploaded_at', modified: 'd.updated_at',
  }
  // Allow-listed: the sort column is interpolated into SQL, so it can never
  // come from the query string directly.
  const sortColumn = SORTS[String(req.query.sort)] || 'd.uploaded_at'
  const direction = String(req.query.direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC'

  const rows = await all(
    `SELECT ${DOCUMENT_COLUMNS}, f.folder_name
       FROM documents d
       LEFT JOIN document_folders f ON f.id = d.folder_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${sortColumn} ${direction}
      LIMIT ? OFFSET ?`,
    [...params, limit + 1, offset],
  )
  const items = rows.slice(0, limit)
  const hasMore = rows.length > limit

  const used = await usedBytes(found.space.id)
  res.json({
    items,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
    storage: {
      usedBytes: used,
      limitBytes: quotaFor(found.space),
      maxFileBytes: fileCapFor(found.space),
    },
    myRole: found.role,
  })
}))

/**
 * POST /api/spaces/:spaceId/documents — upload a new document.
 *
 * multipart/form-data: the file in a field named "file", metadata alongside it
 * as ordinary form fields. The body never passes through express.json, so the
 * app's global 25mb JSON limit is untouched by a 100 MB document.
 */
router.post('/spaces/:spaceId/documents', documentUpload, asyncHandler(async (req, res) => withTempCleanup(req, async () => {
  const found = await loadSpace(req.params.spaceId, req.user)
  if (!found) return notFound(res, 'Space')
  if (!spaceRoleAtLeast(found.role, 'Member')) {
    return res.status(403).json({ error: 'You do not have permission to upload to this Space' })
  }
  if (found.space.archived) {
    return res.status(409).json({ error: 'This Space is archived and does not accept new documents' })
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file was uploaded. Attach one in a field named "file".' })
  }
  // Multipart fields arrive as strings; folderId is '' when the UI leaves the
  // document at the Space root.
  const { description = '', tags = '' } = req.body || {}
  const folderId = req.body?.folderId ? Number(req.body.folderId) : null
  const filename = safeDisplayName(req.file.originalname)

  const lengthErr = maxLengthError('filename', String(filename), NAME_MAX)
    || maxLengthError('description', String(description), DESCRIPTION_MAX)
    || maxLengthError('tags', String(tags), TAGS_MAX)
  if (lengthErr) return res.status(400).json({ error: lengthErr })

  if (folderId) {
    const folder = await get(
      'SELECT id FROM document_folders WHERE id = ? AND space_id = ?',
      [Number(folderId), found.space.id],
    )
    if (!folder) return res.status(400).json({ error: 'Folder not found in this Space' })
  }

  // Duplicate detection (section 4): same name, same folder, still live.
  const duplicate = await get(
    folderId
      ? 'SELECT id FROM documents WHERE space_id = ? AND folder_id = ? AND LOWER(file_name) = LOWER(?) AND deleted_at IS NULL'
      : 'SELECT id FROM documents WHERE space_id = ? AND folder_id IS NULL AND LOWER(file_name) = LOWER(?) AND deleted_at IS NULL',
    folderId ? [found.space.id, Number(folderId), String(filename)] : [found.space.id, String(filename)],
  )
  if (duplicate) {
    return res.status(409).json({
      error: `A document named "${filename}" already exists here. Replace it to add a new version, or rename this file.`,
      existingDocumentId: duplicate.id,
    })
  }

  const stored = await acceptUpload({
    space: found.space,
    file: req.file,
    currentBytes: await usedBytes(found.space.id),
  })
  if (stored.error) return res.status(stored.error.status || 400).json({ error: stored.error.error })

  const mimeType = req.file.mimetype
  const created = await run(
    `INSERT INTO documents
       (space_id, folder_id, file_name, original_file_name, file_extension, mime_type,
        file_size, storage_key, storage_backend, description, tags, uploaded_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      found.space.id, folderId ? Number(folderId) : null, String(filename), String(filename),
      stored.ext, mimeType || null, stored.size, stored.key, stored.backend,
      String(description), String(tags), req.user.email, req.user.email,
    ],
  )
  // Version 1 is a real row, not an implied one: "download version 1" has to
  // work the same way as every later version.
  await run(
    `INSERT INTO document_versions
       (document_id, version_number, file_name, file_size, mime_type, storage_key, storage_backend, uploaded_by, change_comment)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    [created.lastID, String(filename), stored.size, mimeType || null, stored.key, stored.backend, req.user.email, 'Initial upload'],
  )
  safeAppendAudit({
    actor: req.user.email,
    action: 'document.uploaded',
    target: `document:${created.lastID}`,
    metadata: { spaceId: found.space.id, fileName: filename, size: stored.size },
  })

  const row = await get(`SELECT ${DOCUMENT_COLUMNS} FROM documents d WHERE d.id = ?`, [created.lastID])
  res.status(201).json(row)
})))

/** GET /api/documents/:documentId/versions — version history. */
router.get('/documents/:documentId/versions', asyncHandler(async (req, res) => {
  const found = await loadDocument(req.params.documentId, req.user)
  if (!found) return notFound(res)
  const rows = await all(
    `SELECT id, document_id, version_number, file_name, file_size, mime_type,
            uploaded_by, uploaded_at, change_comment
       FROM document_versions WHERE document_id = ? ORDER BY version_number DESC`,
    [found.doc.id],
  )
  res.json({ items: rows, currentVersion: found.doc.current_version })
}))

/**
 * POST /api/documents/:documentId/versions — replace, keeping the old one.
 *
 * multipart, for the same reason as the upload route above.
 */
router.post('/documents/:documentId/versions', documentUpload, asyncHandler(async (req, res) => withTempCleanup(req, async () => {
  const found = await loadDocument(req.params.documentId, req.user)
  if (!found) return notFound(res)
  if (!spaceRoleAtLeast(found.role, 'Member')) {
    return res.status(403).json({ error: 'You do not have permission to replace documents in this Space' })
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file was uploaded. Attach one in a field named "file".' })
  }
  const { changeComment = '' } = req.body || {}

  const stored = await acceptUpload({
    space: found.space,
    file: req.file,
    currentBytes: await usedBytes(found.space.id),
  })
  if (stored.error) return res.status(stored.error.status || 400).json({ error: stored.error.error })

  const name = stored.displayName
  const mimeType = req.file.mimetype

  /*
   * A NEW row, and the previous version's storage_key is left alone. The spec
   * is explicit that replacing must not overwrite, and that is only true if
   * the old bytes survive — otherwise "download previous version" would return
   * the new file under an old number.
   */
  const next = Number(found.doc.current_version) + 1
  await run(
    `INSERT INTO document_versions
       (document_id, version_number, file_name, file_size, mime_type, storage_key, storage_backend, uploaded_by, change_comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [found.doc.id, next, name, stored.size, mimeType || null, stored.key, stored.backend, req.user.email, String(changeComment)],
  )
  await run(
    `UPDATE documents SET file_name = ?, file_extension = ?, mime_type = ?, file_size = ?,
       storage_key = ?, storage_backend = ?, current_version = ?, updated_by = ?, updated_at = NOW()
     WHERE id = ?`,
    [name, stored.ext, mimeType || null, stored.size, stored.key, stored.backend, next, req.user.email, found.doc.id],
  )
  safeAppendAudit({
    actor: req.user.email,
    action: 'document.replaced',
    target: `document:${found.doc.id}`,
    metadata: { version: next, fileName: name },
  })
  res.status(201).json(await get(`SELECT ${DOCUMENT_COLUMNS} FROM documents d WHERE d.id = ?`, [found.doc.id]))
})))

/** POST /api/documents/:documentId/restore/:versionId — restore as a new version. */
router.post('/documents/:documentId/restore/:versionId', asyncHandler(async (req, res) => {
  const found = await loadDocument(req.params.documentId, req.user)
  if (!found) return notFound(res)
  if (!spaceRoleAtLeast(found.role, 'Admin')) {
    return res.status(403).json({ error: 'Only a Space Admin can restore a version' })
  }
  const version = await get(
    'SELECT * FROM document_versions WHERE id = ? AND document_id = ?',
    [Number(req.params.versionId), found.doc.id],
  )
  if (!version) return notFound(res, 'Version')

  /*
   * Restore APPENDS — the restored content becomes a new, higher version
   * rather than rewinding the counter. History is a record, not a mutable
   * document (JL-108). The storage_key is reused, so no bytes are copied and
   * both version rows legitimately describe the same object.
   */
  const next = Number(found.doc.current_version) + 1
  await run(
    `INSERT INTO document_versions
       (document_id, version_number, file_name, file_size, mime_type, storage_key, storage_backend, uploaded_by, change_comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      found.doc.id, next, version.file_name, version.file_size, version.mime_type,
      version.storage_key, version.storage_backend, req.user.email,
      `Restored from version ${version.version_number}`,
    ],
  )
  await run(
    `UPDATE documents SET file_name = ?, mime_type = ?, file_size = ?, storage_key = ?,
       storage_backend = ?, current_version = ?, updated_by = ?, updated_at = NOW()
     WHERE id = ?`,
    [version.file_name, version.mime_type, version.file_size, version.storage_key,
      version.storage_backend, next, req.user.email, found.doc.id],
  )
  safeAppendAudit({
    actor: req.user.email,
    action: 'document.restored',
    target: `document:${found.doc.id}`,
    metadata: { restoredFrom: version.version_number, newVersion: next },
  })
  res.json(await get(`SELECT ${DOCUMENT_COLUMNS} FROM documents d WHERE d.id = ?`, [found.doc.id]))
}))

/** GET /api/documents/:documentId/download — the bytes, as a download. */
router.get('/documents/:documentId/download', asyncHandler(async (req, res) => {
  const found = await loadDocument(req.params.documentId, req.user)
  if (!found) return notFound(res)

  // ?versionId= fetches a specific historical version; without it, current.
  let key = found.doc.storage_key
  let name = found.doc.file_name
  let mime = found.doc.mime_type
  if (req.query.versionId) {
    const version = await get(
      'SELECT * FROM document_versions WHERE id = ? AND document_id = ?',
      [Number(req.query.versionId), found.doc.id],
    )
    if (!version) return notFound(res, 'Version')
    key = version.storage_key; name = version.file_name; mime = version.mime_type
  }

  const storage = getStorage()
  try {
    // basename, always: the key never leaves this process as a path, and a
    // crafted key must not be able to climb out of the storage directory.
    const buffer = await storage.get(path.basename(key))
    res.setHeader('Content-Type', mime || 'application/octet-stream')
    /*
     * `attachment`, never `inline`. An uploaded SVG or HTML rendered inline on
     * this origin would execute with the app's cookies. The preview route
     * below is the only inline path, and it admits a narrower set of types.
     */
    res.setHeader('Content-Disposition', `attachment; filename="${String(name).replace(/"/g, '')}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    safeAppendAudit({
      actor: req.user.email,
      action: 'document.downloaded',
      target: `document:${found.doc.id}`,
      metadata: { fileName: name },
    })
    res.send(buffer)
  } catch {
    // The row outlives an object that has gone missing; saying so beats a 500.
    res.status(404).json({ error: 'That file is no longer stored' })
  }
}))

/** GET /api/documents/:documentId/preview — inline, for the safe subset. */
router.get('/documents/:documentId/preview', asyncHandler(async (req, res) => {
  const found = await loadDocument(req.params.documentId, req.user)
  if (!found) return notFound(res)

  const kind = previewKind(found.doc.file_extension)
  if (!kind) {
    return res.status(415).json({
      error: 'Preview not available for this file type. Download the document to view it.',
    })
  }

  const storage = getStorage()
  try {
    const buffer = await storage.get(path.basename(found.doc.storage_key))
    // Text previews are served as text/plain regardless of what was uploaded:
    // an .xml or .svg labelled as markup and rendered would be script on this
    // origin. As text it is only ever read.
    const type = kind === 'text'
      ? 'text/plain; charset=utf-8'
      : (found.doc.mime_type || 'application/octet-stream')
    res.setHeader('Content-Type', type)
    res.setHeader('Content-Disposition', `inline; filename="${String(found.doc.file_name).replace(/"/g, '')}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    // Belt and braces for the one inline path in the feature: even a body that
    // slipped through as markup has no script, no plugins and no origin here.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
    res.send(buffer)
  } catch {
    res.status(404).json({ error: 'That file is no longer stored' })
  }
}))

/** GET /api/documents/:documentId — one document's metadata. */
router.get('/documents/:documentId', asyncHandler(async (req, res) => {
  const found = await loadDocument(req.params.documentId, req.user)
  if (!found) return notFound(res)
  const row = await get(
    `SELECT ${DOCUMENT_COLUMNS}, f.folder_name
       FROM documents d LEFT JOIN document_folders f ON f.id = d.folder_id
      WHERE d.id = ?`,
    [found.doc.id],
  )
  res.json({ ...row, myRole: found.role, previewKind: previewKind(found.doc.file_extension) })
}))

/** PUT /api/documents/:documentId — rename, re-describe, re-tag, or move. */
router.put('/documents/:documentId', asyncHandler(async (req, res) => {
  const found = await loadDocument(req.params.documentId, req.user)
  if (!found) return notFound(res)
  if (!spaceRoleAtLeast(found.role, 'Member')) {
    return res.status(403).json({ error: 'You do not have permission to edit documents in this Space' })
  }

  const sets = []
  const params = []
  const body = req.body || {}

  if (body.fileName !== undefined) {
    const name = String(body.fileName).trim()
    if (!name) return res.status(400).json({ error: 'fileName cannot be empty' })
    const err = maxLengthError('fileName', name, NAME_MAX)
    if (err) return res.status(400).json({ error: err })
    sets.push('file_name = ?'); params.push(name)
  }
  if (body.description !== undefined) {
    const err = maxLengthError('description', String(body.description), DESCRIPTION_MAX)
    if (err) return res.status(400).json({ error: err })
    sets.push('description = ?'); params.push(String(body.description))
  }
  if (body.tags !== undefined) {
    const err = maxLengthError('tags', String(body.tags), TAGS_MAX)
    if (err) return res.status(400).json({ error: err })
    sets.push('tags = ?'); params.push(String(body.tags))
  }
  if (body.folderId !== undefined) {
    // Moving is an Admin action (section 11) even though renaming is not.
    if (!spaceRoleAtLeast(found.role, 'Admin')) {
      return res.status(403).json({ error: 'Only a Space Admin can move documents' })
    }
    const folderId = body.folderId ? Number(body.folderId) : null
    if (folderId) {
      const folder = await get(
        'SELECT id FROM document_folders WHERE id = ? AND space_id = ?',
        [folderId, found.doc.space_id],
      )
      if (!folder) return res.status(400).json({ error: 'Folder not found in this Space' })
    }
    sets.push('folder_id = ?'); params.push(folderId)
  }
  if (!sets.length) return res.status(400).json({ error: 'No supported fields to update' })

  sets.push('updated_by = ?'); params.push(req.user.email)
  sets.push('updated_at = NOW()')
  await run(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`, [...params, found.doc.id])
  safeAppendAudit({
    actor: req.user.email,
    action: 'document.updated',
    target: `document:${found.doc.id}`,
    metadata: { fields: Object.keys(body) },
  })
  res.json(await get(`SELECT ${DOCUMENT_COLUMNS} FROM documents d WHERE d.id = ?`, [found.doc.id]))
}))

/** DELETE /api/documents/:documentId — soft delete. */
router.delete('/documents/:documentId', asyncHandler(async (req, res) => {
  const found = await loadDocument(req.params.documentId, req.user)
  if (!found) return notFound(res)
  if (!spaceRoleAtLeast(found.role, 'Admin')) {
    return res.status(403).json({ error: 'Only a Space Admin can delete a document' })
  }
  /*
   * Soft, and the stored object is left in place. A delete that destroyed the
   * bytes would make the audit entry unverifiable and the action
   * unrecoverable; reclaiming storage is a separate, deliberate purge.
   */
  await run(
    'UPDATE documents SET deleted_at = NOW(), status = ?, updated_by = ? WHERE id = ?',
    ['deleted', req.user.email, found.doc.id],
  )
  safeAppendAudit({
    actor: req.user.email,
    action: 'document.deleted',
    target: `document:${found.doc.id}`,
    metadata: { spaceId: found.doc.space_id, fileName: found.doc.file_name },
  })
  res.json({ ok: true, id: found.doc.id })
}))

export default router
