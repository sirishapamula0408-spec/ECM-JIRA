import { Router } from 'express'
import crypto from 'node:crypto'
import path from 'node:path'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { getStorage } from '../services/storage.js'
import { generateThumbnail } from '../services/thumbnails.js'
import { scanBuffer } from '../services/virusScan.js'
import { canViewIssue } from '../services/issueSecurity.js'

const router = Router()

// JL-185: load an attachment's parent issue (with the fields canViewIssue needs)
// and confirm the caller may view it. Returns true when access is allowed.
// A missing parent issue (orphan / FK-less) carries no security level and is
// treated as public, so non-restricted issues stay visible → unchanged behaviour.
// Only issues with a security_level_id are ever blocked.
async function canAccessIssueAttachments(issueId, user) {
  const issue = await get(
    'SELECT id, assignee, reporter, security_level_id FROM issues WHERE id = ?',
    [Number(issueId)],
  )
  return canViewIssue(issue || {}, user)
}

function mapAttachment(row) {
  return {
    id: row.id,
    issueId: row.issue_id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size_bytes,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    isImage: /^image\//.test(row.mime_type || ''),
    storageBackend: row.storage_backend || 'local',
    hasThumbnail: Boolean(row.thumbnail_key),
  }
}

// GET /api/issues/:issueId/attachments — list metadata
router.get('/issues/:issueId/attachments', asyncHandler(async (req, res) => {
  // JL-185: block listing attachments of an issue the caller cannot view.
  if (!(await canAccessIssueAttachments(req.params.issueId, req.user))) {
    res.status(403).json({ error: 'Not authorized to view this issue' })
    return
  }
  const rows = await all(
    'SELECT * FROM attachments WHERE issue_id = ? ORDER BY created_at DESC',
    [Number(req.params.issueId)],
  )
  res.json(rows.map(mapAttachment))
}))

// POST /api/issues/:issueId/attachments — upload { filename, mime, dataBase64 }
router.post('/issues/:issueId/attachments', requireRole('Member'), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const issue = await get('SELECT id FROM issues WHERE id = ?', [issueId])
  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return }

  const filename = String(req.body?.filename || '').trim()
  const mime = String(req.body?.mime || 'application/octet-stream').trim()
  const dataBase64 = String(req.body?.dataBase64 || '')
  if (!filename || !dataBase64) { res.status(400).json({ error: 'filename and dataBase64 are required' }); return }

  const buffer = Buffer.from(dataBase64, 'base64')
  if (buffer.length === 0) { res.status(400).json({ error: 'Empty file' }); return }

  // 1. Virus scan — reject infected uploads before touching storage.
  const scan = await scanBuffer(buffer)
  if (!scan.clean) {
    res.status(422).json({ error: 'File failed virus scan', reason: scan.reason })
    return
  }

  const storage = getStorage()
  const key = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${filename.replace(/[^\w.-]/g, '_')}`

  // 2. Store the object via the active backend (S3 or local).
  await storage.put(key, buffer, mime)

  // 3. Generate + store a thumbnail for images (non-fatal on failure).
  let thumbnailKey = null
  const thumb = await generateThumbnail(buffer, mime, { width: 200 })
  if (thumb) {
    thumbnailKey = `${key}.thumb`
    try {
      await storage.put(thumbnailKey, thumb, 'image/png')
    } catch (err) {
      console.warn('[attachments] failed to store thumbnail:', err?.message || err)
      thumbnailKey = null
    }
  }

  const created = await run(
    'INSERT INTO attachments (issue_id, filename, mime_type, size_bytes, storage_path, uploaded_by, storage_backend, thumbnail_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [issueId, filename, mime, buffer.length, key, req.user.email, storage.backend, thumbnailKey],
  )
  const row = await get('SELECT * FROM attachments WHERE id = ?', [created.lastID])
  res.status(201).json(mapAttachment(row))
}))

// GET /api/attachments/:id/download — stream the file
router.get('/attachments/:id/download', asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM attachments WHERE id = ?', [Number(req.params.id)])
  if (!row) { res.status(404).json({ error: 'Attachment not found' }); return }
  // JL-185: prevent IDOR — the caller must be able to view the parent issue.
  if (!(await canAccessIssueAttachments(row.issue_id, req.user))) {
    res.status(403).json({ error: 'Not authorized to view this issue' })
    return
  }
  const storage = getStorage()
  try {
    const buffer = await storage.get(path.basename(row.storage_path))
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`)
    res.send(buffer)
  } catch {
    res.status(404).json({ error: 'File data missing' })
  }
}))

// GET /api/attachments/:id/thumbnail — stream the image thumbnail
router.get('/attachments/:id/thumbnail', asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM attachments WHERE id = ?', [Number(req.params.id)])
  if (!row || !row.thumbnail_key) { res.status(404).json({ error: 'Thumbnail not found' }); return }
  // JL-185: prevent IDOR — the caller must be able to view the parent issue.
  if (!(await canAccessIssueAttachments(row.issue_id, req.user))) {
    res.status(403).json({ error: 'Not authorized to view this issue' })
    return
  }
  const storage = getStorage()
  try {
    const buffer = await storage.get(path.basename(row.thumbnail_key))
    res.setHeader('Content-Type', 'image/png')
    res.send(buffer)
  } catch {
    res.status(404).json({ error: 'Thumbnail data missing' })
  }
}))

// DELETE /api/attachments/:id — remove row + object + thumbnail
router.delete('/attachments/:id', requireRole('Member'), asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM attachments WHERE id = ?', [Number(req.params.id)])
  if (!row) { res.status(404).json({ error: 'Attachment not found' }); return }
  await run('DELETE FROM attachments WHERE id = ?', [row.id])
  const storage = getStorage()
  await storage.remove(path.basename(row.storage_path))
  if (row.thumbnail_key) {
    await storage.remove(path.basename(row.thumbnail_key))
  }
  res.json({ success: true, id: row.id })
}))

export default router
