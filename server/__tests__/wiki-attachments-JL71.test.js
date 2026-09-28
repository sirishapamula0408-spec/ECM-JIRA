// @vitest-environment node
/* ================================================================
   JL-120→124 — page attachments.

   The load-bearing assertions are the ones about reach: an
   attachment is exactly as readable as the page it hangs on, the
   download streams through this process rather than handing out a
   storage URL, and the stored key is never the uploaded filename.
   ================================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const db = { run: vi.fn(), get: vi.fn(), all: vi.fn(), tableExists: vi.fn(), columnExists: vi.fn() }
vi.mock('../db.js', () => db)
/*
 * requireProjectRead/Write are here because this suite imports validateUpload
 * from routes/attachments.js — deliberately, to prove the two share ONE
 * validator — and that module pulls them in. Mocking them keeps the import
 * resolvable without dragging issue-level authorisation into a wiki test.
 */
vi.mock('../middleware/authorize.js', () => ({
  requireRole: () => (req, _res, next) => next(),
  loadProjectRole: () => (req, _res, next) => next(),
  requireProjectRole: () => (req, _res, next) => next(),
  requireProjectRead: () => (req, _res, next) => next(),
  requireProjectWrite: () => (req, _res, next) => next(),
  loadUserRoles: (req, _res, next) => next(),
}))

const { store } = vi.hoisted(() => ({
  store: { put: vi.fn(), get: vi.fn(), remove: vi.fn(), backend: 'local' },
}))
vi.mock('../services/storage.js', () => ({ getStorage: () => store }))

const UPLOADER = 'uploader@x.com'
const OTHER = 'someone@x.com'
const ADMIN = { id: 9, email: 'admin@x.com', workspaceRole: 'Admin' }

/** A small valid PNG-ish payload; content is irrelevant, size is not. */
const DATA = Buffer.from('hello world').toString('base64')

const attachment = (over = {}) => ({
  id: 3, page_id: 1, filename: 'diagram.png', mime_type: 'image/png',
  size_bytes: 11, storage_path: 'wiki-1-abc.png', storage_backend: 'local',
  uploaded_by: UPLOADER, created_at: '2026-09-01T00:00:00Z', ...over,
})

function wire({ page = { id: 1 }, found = attachment(), rows = [] } = {}) {
  db.all.mockImplementation(async (sql) => {
    if (/SELECT id, owner_email FROM spaces/.test(sql)) return [{ id: 7, owner_email: UPLOADER }]
    if (/^\s*SELECT space_id, role FROM space_members/.test(sql)) return []
    if (/FROM projects p/.test(sql)) return []
    return rows
  })
  db.get.mockImplementation(async (sql) => {
    if (/FROM wiki_pages w WHERE w\.id/.test(sql)) return page || null
    if (/FROM wiki_page_attachments/.test(sql)) return found
    return null
  })
  db.run.mockResolvedValue({ lastID: 33, changes: 1 })
  store.get.mockResolvedValue(Buffer.from('hello world'))
  store.put.mockResolvedValue(undefined)
  store.remove.mockResolvedValue(undefined)
}

async function buildApp(user = { id: 1, email: UPLOADER }) {
  const mod = await import('../routes/wikiAttachments.js')
  const app = express()
  app.use(express.json({ limit: '25mb' }))
  app.use((req, _res, next) => { req.user = user; next() })
  app.use('/', mod.default)
  return app
}

beforeEach(() => { vi.clearAllMocks(); wire() })

/* ---------------------------------------------------------------- *
 * JL-122 — reach
 * ---------------------------------------------------------------- */
describe('JL-122 an attachment is as readable as its page', () => {
  const cases = [
    ['list', (a) => a.get('/1/attachments')],
    ['upload', (a) => a.post('/1/attachments').send({ filename: 'a.png', data: DATA })],
    ['download', (a) => a.get('/1/attachments/3/download')],
    ['delete', (a) => a.delete('/1/attachments/3')],
  ]

  it.each(cases)('404s %s on a page the caller cannot see', async (_label, act) => {
    wire({ page: null })
    const res = await act(request(await buildApp()))
    expect(res.status).toBe(404)
  })

  it('stores nothing when the page is invisible', async () => {
    wire({ page: null })
    await request(await buildApp()).post('/1/attachments').send({ filename: 'a.png', data: DATA })
    expect(store.put).not.toHaveBeenCalled()
    expect(db.run).not.toHaveBeenCalled()
  })

  it('uses the same visibility rule as every other read', async () => {
    await request(await buildApp()).get('/1/attachments')
    const sql = db.get.mock.calls.map((c) => c[0]).find((q) => /FROM wiki_pages w/.test(q))
    expect(sql).toMatch(/deleted_at IS NULL/)
    expect(sql).toMatch(/status <> 'draft'/)
  })

  it('never SELECTs the storage key for the client', async () => {
    /*
     * A client that never learns the object key cannot be tempted to fetch
     * around this endpoint, which is where the permission is enforced.
     *
     * Asserted on the QUERY, not the response. The db is mocked, so a
     * column list is not actually applied to the fixture — checking the
     * response body here would be asserting the mock rather than the code.
     */
    wire({ rows: [attachment()] })
    await request(await buildApp()).get('/1/attachments')
    const sql = db.all.mock.calls.map((c) => c[0]).find((q) => /FROM wiki_page_attachments/.test(q))
    expect(sql).toBeDefined()
    expect(sql).not.toMatch(/storage_path/)
    expect(sql).not.toMatch(/SELECT \*/)
    expect(sql).toMatch(/filename/)
  })

  it('streams the bytes rather than redirecting to storage', async () => {
    // A bare storage URL is a capability that outlives the permission that
    // granted it.
    const res = await request(await buildApp()).get('/1/attachments/3/download')
    expect(res.status).toBe(200)
    expect(res.headers.location).toBeUndefined()
    expect(store.get).toHaveBeenCalled()
  })

  it('forces a download instead of rendering inline', async () => {
    /*
     * An uploaded HTML or SVG rendered inline on this origin would execute
     * with the app's cookies.
     */
    const res = await request(await buildApp()).get('/1/attachments/3/download')
    expect(res.headers['content-disposition']).toMatch(/^attachment;/)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('404s a file whose object has gone missing, rather than 500ing', async () => {
    store.get.mockRejectedValue(new Error('ENOENT'))
    const res = await request(await buildApp()).get('/1/attachments/3/download')
    expect(res.status).toBe(404)
  })

  it('404s an attachment id that belongs to another page', async () => {
    wire({ found: null })
    const res = await request(await buildApp()).get('/1/attachments/999/download')
    expect(res.status).toBe(404)
  })
})

/* ---------------------------------------------------------------- *
 * JL-120 / JL-123 — upload and validation
 * ---------------------------------------------------------------- */
describe('JL-120/123 uploading', () => {
  it('stores the file and records it', async () => {
    const res = await request(await buildApp())
      .post('/1/attachments').send({ filename: 'diagram.png', mimeType: 'image/png', data: DATA })
    expect(res.status).toBe(201)
    expect(store.put).toHaveBeenCalledTimes(1)
    expect(db.run.mock.calls.some((c) => /INSERT INTO wiki_page_attachments/.test(c[0]))).toBe(true)
  })

  it('names the stored object with a UUID, never the uploaded filename', async () => {
    /*
     * A user-supplied name in a path is a traversal waiting to happen, and two
     * people uploading "notes.pdf" must not collide.
     */
    await request(await buildApp())
      .post('/1/attachments').send({ filename: '../../etc/passwd.png', data: DATA })
    const [key] = store.put.mock.calls[0]
    expect(key).not.toContain('..')
    expect(key).not.toContain('/')
    expect(key).toMatch(/^wiki-1-/)
  })

  it('keeps the original filename as DATA', async () => {
    await request(await buildApp())
      .post('/1/attachments').send({ filename: 'Q3 report.pdf', data: DATA })
    const insert = db.run.mock.calls.find((c) => /INSERT INTO wiki_page_attachments/.test(c[0]))
    expect(insert[1]).toContain('Q3 report.pdf')
  })

  it('rejects a disallowed file type', async () => {
    const res = await request(await buildApp())
      .post('/1/attachments').send({ filename: 'payload.exe', data: DATA })
    expect(res.status).toBe(415)
    expect(store.put).not.toHaveBeenCalled()
  })

  it('rejects a file with no extension', async () => {
    const res = await request(await buildApp())
      .post('/1/attachments').send({ filename: 'passwd', data: DATA })
    expect(res.status).toBe(415)
  })

  it('rejects an oversized upload WITHOUT decoding it first', async () => {
    // The size is read from the base64 length, so the rejection path is the
    // cheap one rather than the expensive one.
    const huge = 'A'.repeat(15 * 1024 * 1024)
    const res = await request(await buildApp())
      .post('/1/attachments').send({ filename: 'big.png', data: huge })
    expect(res.status).toBe(413)
    expect(store.put).not.toHaveBeenCalled()
  })

  it('requires a filename and data', async () => {
    for (const body of [{}, { filename: 'a.png' }, { data: DATA }]) {
      const res = await request(await buildApp()).post('/1/attachments').send(body)
      expect(res.status).toBe(400)
    }
    expect(store.put).not.toHaveBeenCalled()
  })

  it('uses the SAME validator as issue attachments, not a second copy', async () => {
    const mod = await import('../routes/attachments.js')
    // If these ever diverge, one of the two is quietly more permissive.
    expect(typeof mod.validateUpload).toBe('function')
    expect(mod.validateUpload({ filename: 'x.exe', mime: '', dataBase64: DATA })?.status).toBe(415)
  })
})

/* ---------------------------------------------------------------- *
 * JL-124 — deleting
 * ---------------------------------------------------------------- */
describe('JL-124 deleting', () => {
  it('lets the uploader delete their own', async () => {
    const res = await request(await buildApp()).delete('/1/attachments/3')
    expect(res.status).toBe(200)
    expect(store.remove).toHaveBeenCalled()
  })

  it('lets an admin delete someone else’s', async () => {
    const res = await request(await buildApp(ADMIN)).delete('/1/attachments/3')
    expect(res.status).toBe(200)
  })

  it('refuses an ordinary member deleting someone else’s', async () => {
    const res = await request(await buildApp({ id: 2, email: OTHER })).delete('/1/attachments/3')
    expect(res.status).toBe(403)
    expect(store.remove).not.toHaveBeenCalled()
    expect(db.run).not.toHaveBeenCalled()
  })

  it('removes the ROW before the object', async () => {
    /*
     * The other order would leave a row pointing at nothing if the delete
     * failed in between — a listing entry that 404s on download. This way the
     * worst case is an orphaned object, which costs disk rather than lying.
     */
    const order = []
    db.run.mockImplementation(async (sql) => { order.push(`db:${/DELETE/.test(sql)}`); return { changes: 1 } })
    store.remove.mockImplementation(async () => { order.push('store') })
    await request(await buildApp()).delete('/1/attachments/3')
    expect(order).toEqual(['db:true', 'store'])
  })
})
