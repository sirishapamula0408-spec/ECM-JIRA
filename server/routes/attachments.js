import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

const UPLOAD_DIR = fileURLToPath(new URL('../uploads/', import.meta.url))

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
  }
}

// GET /api/issues/:issueId/attachments — list metadata
router.get('/issues/:issueId/attachments', asyncHandler(async (req, res) => {
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

  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${filename.replace(/[^\w.-]/g, '_')}`
  const storagePath = path.join(UPLOAD_DIR, safeName)
  await fs.writeFile(storagePath, buffer)

  const created = await run(
    'INSERT INTO attachments (issue_id, filename, mime_type, size_bytes, storage_path, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
    [issueId, filename, mime, buffer.length, safeName, req.user.email],
  )
  const row = await get('SELECT * FROM attachments WHERE id = ?', [created.lastID])
  res.status(201).json(mapAttachment(row))
}))

// GET /api/attachments/:id/download — stream the file
router.get('/attachments/:id/download', asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM attachments WHERE id = ?', [Number(req.params.id)])
  if (!row) { res.status(404).json({ error: 'Attachment not found' }); return }
  const filePath = path.join(UPLOAD_DIR, path.basename(row.storage_path))
  try {
    const buffer = await fs.readFile(filePath)
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`)
    res.send(buffer)
  } catch {
    res.status(404).json({ error: 'File data missing' })
  }
}))

// DELETE /api/attachments/:id — remove row + file
router.delete('/attachments/:id', requireRole('Member'), asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM attachments WHERE id = ?', [Number(req.params.id)])
  if (!row) { res.status(404).json({ error: 'Attachment not found' }); return }
  await run('DELETE FROM attachments WHERE id = ?', [row.id])
  await fs.unlink(path.join(UPLOAD_DIR, path.basename(row.storage_path))).catch(() => {})
  res.json({ success: true, id: row.id })
}))

export default router
