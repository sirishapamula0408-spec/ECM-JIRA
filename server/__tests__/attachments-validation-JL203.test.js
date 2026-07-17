// @vitest-environment node
// JL-203: attachment upload validation — size cap (413) + type allowlist (415),
// enforced before anything is written to disk/storage.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ---- Mock db.js (mocked-db style, model: collaboration-modules.test.js) ----
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// ---- Mock the storage backend so no real file I/O happens; the put spy lets
// us assert nothing is written when validation rejects the upload. ----
const storagePut = vi.fn(async () => {})
vi.mock('../services/storage.js', () => ({
  getStorage: () => ({
    backend: 'local',
    put: storagePut,
    get: vi.fn(),
    remove: vi.fn(),
  }),
}))

// Thumbnails are irrelevant here — skip image processing entirely.
vi.mock('../services/thumbnails.js', () => ({
  generateThumbnail: vi.fn(async () => null),
}))

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import attachmentsRouter, {
  MAX_ATTACHMENT_BYTES,
  validateUpload,
  estimateBase64Bytes,
} from '../routes/attachments.js'

function createApp() {
  const app = express()
  app.use(express.json({ limit: '25mb' }))
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: true }
    next()
  })
  app.use('/api', attachmentsRouter)
  app.use(errorHandler)
  return app
}

let app
beforeEach(() => {
  vi.clearAllMocks()
  app = createApp()
})

/* ================================================================
   Happy path — a valid upload still succeeds end-to-end
   ================================================================ */
describe('POST /api/issues/:id/attachments — valid upload', () => {
  it('accepts an allowed type under the size cap and stores it (201)', async () => {
    const dataBase64 = Buffer.from('hello attachment world', 'utf8').toString('base64')
    get
      .mockResolvedValueOnce({ id: 5 }) // issue exists
      .mockResolvedValueOnce({          // re-fetch created row
        id: 42, issue_id: 5, filename: 'notes.txt', mime_type: 'text/plain',
        size_bytes: 22, uploaded_by: 'test@test.com', created_at: 'now',
        storage_backend: 'local', thumbnail_key: null,
      })
    run.mockResolvedValue({ lastID: 42 })

    const res = await request(app)
      .post('/api/issues/5/attachments')
      .send({ filename: 'notes.txt', mime: 'text/plain', dataBase64 })

    expect(res.status).toBe(201)
    expect(res.body.filename).toBe('notes.txt')
    expect(res.body.mimeType).toBe('text/plain')
    expect(storagePut).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('accepts an allowed image type (png)', async () => {
    const dataBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
    get
      .mockResolvedValueOnce({ id: 5 })
      .mockResolvedValueOnce({
        id: 43, issue_id: 5, filename: 'shot.png', mime_type: 'image/png',
        size_bytes: 4, uploaded_by: 'test@test.com', created_at: 'now',
        storage_backend: 'local', thumbnail_key: null,
      })
    run.mockResolvedValue({ lastID: 43 })

    const res = await request(app)
      .post('/api/issues/5/attachments')
      .send({ filename: 'shot.png', mime: 'image/png', dataBase64 })

    expect(res.status).toBe(201)
    expect(res.body.isImage).toBe(true)
  })
})

/* ================================================================
   Size cap — oversize payload → 413, nothing written
   ================================================================ */
describe('size cap (413)', () => {
  it('rejects a payload whose decoded size exceeds the cap, before any write', async () => {
    get.mockResolvedValueOnce({ id: 5 }) // issue exists
    // ~14M base64 chars → ~10.5 MB decoded, over the 10 MB cap but under the
    // 25 MB express.json limit. 'A'.repeat keeps it cheap (no real decode
    // happens server-side — the estimate rejects first).
    const oversize = 'A'.repeat(14 * 1024 * 1024)

    const res = await request(app)
      .post('/api/issues/5/attachments')
      .send({ filename: 'big.pdf', mime: 'application/pdf', dataBase64: oversize })

    expect(res.status).toBe(413)
    expect(res.body.error).toMatch(/too large/i)
    expect(storagePut).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('estimateBase64Bytes matches real decoded sizes (padding-aware)', () => {
    for (const len of [1, 2, 3, 4, 100, 1000]) {
      const b64 = Buffer.alloc(len, 7).toString('base64')
      expect(estimateBase64Bytes(b64)).toBe(len)
    }
    expect(estimateBase64Bytes('')).toBe(0)
  })

  it('accepts a payload exactly at the cap boundary (validateUpload unit)', () => {
    const atCap = 'A'.repeat((MAX_ATTACHMENT_BYTES / 3) * 4) // decodes to exactly the cap
    expect(validateUpload({ filename: 'ok.txt', mime: 'text/plain', dataBase64: atCap })).toBeNull()
  })
})

/* ================================================================
   Type allowlist — disallowed type → 415, nothing written
   ================================================================ */
describe('type allowlist (415)', () => {
  it('rejects a disallowed extension (.exe) before any write', async () => {
    get.mockResolvedValueOnce({ id: 5 })
    const res = await request(app)
      .post('/api/issues/5/attachments')
      .send({
        filename: 'malware.exe',
        mime: 'application/octet-stream',
        dataBase64: Buffer.from('MZ...').toString('base64'),
      })

    expect(res.status).toBe(415)
    expect(res.body.error).toMatch(/not allowed/i)
    expect(storagePut).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a disallowed MIME type even with an allowed extension', async () => {
    get.mockResolvedValueOnce({ id: 5 })
    const res = await request(app)
      .post('/api/issues/5/attachments')
      .send({
        filename: 'page.txt',
        mime: 'text/html',
        dataBase64: Buffer.from('<script>alert(1)</script>').toString('base64'),
      })

    expect(res.status).toBe(415)
    expect(res.body.error).toMatch(/mime type/i)
    expect(storagePut).not.toHaveBeenCalled()
  })

  it('rejects a filename with no extension', async () => {
    get.mockResolvedValueOnce({ id: 5 })
    const res = await request(app)
      .post('/api/issues/5/attachments')
      .send({ filename: 'README', mime: 'text/plain', dataBase64: Buffer.from('hi').toString('base64') })

    expect(res.status).toBe(415)
    expect(storagePut).not.toHaveBeenCalled()
  })

  it('extension check is case-insensitive (PNG accepted)', () => {
    expect(validateUpload({
      filename: 'SHOT.PNG', mime: 'image/png', dataBase64: 'aGk=',
    })).toBeNull()
  })
})

/* ================================================================
   Existing behavior preserved
   ================================================================ */
describe('existing behavior intact', () => {
  it('still 404s when the issue does not exist', async () => {
    get.mockResolvedValueOnce(undefined)
    const res = await request(app)
      .post('/api/issues/999/attachments')
      .send({ filename: 'a.txt', mime: 'text/plain', dataBase64: 'aGk=' })
    expect(res.status).toBe(404)
  })

  it('still 400s on missing filename/dataBase64', async () => {
    get.mockResolvedValueOnce({ id: 5 })
    const res = await request(app).post('/api/issues/5/attachments').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/filename and dataBase64/i)
  })
})
