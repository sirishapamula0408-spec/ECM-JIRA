// @vitest-environment node
/* ================================================================
   JL-164 — the Space Document Store.

   Uploads are multipart/form-data, not base64-over-JSON. A 100 MB
   file base64-encoded is ~134 MB of JSON body, and admitting that
   would mean raising the app's GLOBAL express.json limit for every
   endpoint — a denial-of-service lever handed out for two routes.
   Multipart bodies never reach the JSON parser at all.

   The assertions that carry this suite are about REACH and REFUSAL,
   not the happy path:

     - an executable is refused whatever MIME type it claims
     - a file whose BYTES contradict its extension is refused, because
       with multipart the filename and Content-Type are both just
       client-supplied strings
     - a filename carrying ../ cannot escape the storage root
     - the temp file is removed on every rejection path
     - a Space the caller cannot see is 404, never 403
     - replacing never destroys the version it replaced
     - a restore APPENDS rather than rewinding
     - downloads are `attachment`, never inline: an uploaded SVG
       rendered inline on this origin is stored XSS
     - the quota counts retained versions, or a Space grows without
       limit by replacing one file repeatedly
   ================================================================ */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import fsp from 'node:fs/promises'

const db = { run: vi.fn(), get: vi.fn(), all: vi.fn(), tableExists: vi.fn(), columnExists: vi.fn() }
vi.mock('../db.js', () => db)
vi.mock('../middleware/authorize.js', () => ({
  requireRole: () => (req, _res, next) => next(),
  loadProjectRole: () => (req, _res, next) => next(),
  requireProjectRole: () => (req, _res, next) => next(),
  requireProjectRead: () => (req, _res, next) => next(),
  requireProjectWrite: () => (req, _res, next) => next(),
  loadUserRoles: (req, _res, next) => next(),
}))

const { audit, store } = vi.hoisted(() => ({
  audit: { safeAppendAudit: vi.fn() },
  store: {
    put: vi.fn(), putStream: vi.fn(), get: vi.fn(), remove: vi.fn(),
    url: vi.fn(), backend: 'local',
  },
}))
vi.mock('../services/auditLog.js', () => audit)
vi.mock('../services/storage.js', () => ({ getStorage: () => store }))

const { TEMP_DIR } = await import('../middleware/documentUpload.js')

const OWNER = 'owner@x.com'
const MEMBER = 'member@x.com'
const STRANGER = 'nobody@x.com'

const SPACE = {
  id: 7, key: 'ENG', name: 'Engineering', owner_email: OWNER,
  archived: false, storage_limit_bytes: null, max_document_bytes: null,
}
const DOC = {
  id: 3, space_id: 7, folder_id: null, file_name: 'Requirements.pdf',
  original_file_name: 'Requirements.pdf', file_extension: 'pdf',
  mime_type: 'application/pdf', file_size: 1024, storage_key: 'doc-7-abc.pdf',
  storage_backend: 'local', description: '', tags: '', uploaded_by: OWNER,
  current_version: 2, status: 'active', deleted_at: null,
}

/*
 * Real leading bytes per type. The magic-byte check is one of the things
 * under test, so a payload of 'AAAA' named .pdf would be refused — correctly.
 */
const HEADS = {
  pdf: [0x25, 0x50, 0x44, 0x46],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff],
  gif: [0x47, 0x49, 0x46, 0x38],
  zip: [0x50, 0x4b, 0x03, 0x04],
  docx: [0x50, 0x4b, 0x03, 0x04],
  xlsx: [0x50, 0x4b, 0x03, 0x04],
  pptx: [0x50, 0x4b, 0x03, 0x04],
  '7z': [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
}

/** A plausible body for `name`, padded to `bytes` total. */
function bodyFor(name, bytes = 64) {
  const ext = String(name).split('.').pop().toLowerCase()
  const head = Buffer.from(HEADS[ext] || [])
  const padLength = Math.max(bytes - head.length, 1)
  return Buffer.concat([head, Buffer.alloc(padLength, 0x41)])
}

function wire({
  space = SPACE, doc = DOC, role = null, used = 0,
  duplicate = null, version = null, folder = null,
  docCount = 0, kidCount = 0,
} = {}) {
  db.get.mockImplementation(async (sql) => {
    if (/FROM spaces WHERE/.test(sql)) return space
    if (/FROM space_members WHERE space_id/.test(sql)) return role ? { role } : undefined
    if (/FROM documents WHERE id = \? AND deleted_at IS NULL/.test(sql)) return doc
    if (/AS used/.test(sql)) return { used }
    if (/SELECT id FROM documents WHERE space_id/.test(sql)) return duplicate
    if (/FROM document_versions WHERE id = \?/.test(sql)) return version
    if (/FROM document_folders WHERE id = \?/.test(sql)) return folder
    if (/COUNT\(\*\)::int AS n FROM documents/.test(sql)) return { n: docCount }
    if (/COUNT\(\*\)::int AS n FROM document_folders/.test(sql)) return { n: kidCount }
    if (/FROM documents d WHERE d\.id/.test(sql)) return doc
    return undefined
  })
  db.all.mockResolvedValue([])
  db.run.mockResolvedValue({ lastID: 11, changes: 1 })
  store.putStream.mockResolvedValue(undefined)
  store.put.mockResolvedValue(undefined)
  store.get.mockResolvedValue(Buffer.from('file-bytes'))
}

async function buildApp(user) {
  const mod = await import('../routes/documents.js')
  const app = express()
  // JSON for the metadata routes only. The upload routes are multipart and
  // never reach this parser — which is the whole point of the design.
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use('/', mod.default)
  return app
}

const as = (email, workspaceRole = 'Member') => ({ id: 1, email, workspaceRole })

/** How many temp files are sitting in the upload scratch directory. */
async function tempCount() {
  const names = await fsp.readdir(TEMP_DIR).catch(() => [])
  return names.filter((n) => n.startsWith('upload-')).length
}

beforeEach(() => {
  vi.clearAllMocks()
  db.all.mockResolvedValue([])
})

afterEach(async () => {
  // No test may leave a temp file behind; see the cleanup assertions below.
  const names = await fsp.readdir(TEMP_DIR).catch(() => [])
  await Promise.all(names.map((n) => fsp.unlink(`${TEMP_DIR}/${n}`).catch(() => {})))
})

/* ---------------------------------------------------------------- *
 * Type safety — sections 2 and 12
 * ---------------------------------------------------------------- */
describe('JL-164 executables are refused', () => {
  it.each(['payload.exe', 'run.bat', 'go.cmd', 'setup.msi', 'x.scr', 'a.com', 's.ps1', 'm.vbs'])(
    'refuses %s', async (filename) => {
      wire()
      const res = await request(await buildApp(as(OWNER)))
        .post('/spaces/7/documents')
        .attach('file', bodyFor(filename), filename)
      expect(res.status).toBe(415)
      expect(res.body.error).toMatch(/Executable files are not allowed/)
      expect(store.putStream, 'nothing may reach storage').not.toHaveBeenCalled()
    },
  )

  it('refuses an executable even when it claims an allowed MIME type', async () => {
    // The extension check runs first precisely so a lie about the MIME type
    // cannot buy an .exe a pass.
    wire()
    const res = await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents')
      .attach('file', bodyFor('x.exe'), { filename: 'invoice.exe', contentType: 'application/pdf' })
    expect(res.status).toBe(415)
    expect(store.putStream).not.toHaveBeenCalled()
  })

  it('accepts the business formats the spec lists', async () => {
    for (const filename of ['a.pdf', 'b.docx', 'c.xlsx', 'd.pptx', 'e.csv', 'f.png', 'g.zip', 'h.json', 'i.yaml', 'j.sql']) {
      wire()
      const res = await request(await buildApp(as(OWNER)))
        .post('/spaces/7/documents')
        .attach('file', bodyFor(filename), filename)
      expect(res.status, filename).toBe(201)
    }
  })

  it('refuses a file whose BYTES contradict its extension', async () => {
    /*
     * Section 12: never trust the extension alone. With multipart both the
     * filename and the Content-Type are client-supplied strings, so the
     * leading bytes are the only part that cannot simply be relabelled.
     */
    wire()
    const res = await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents')
      .attach('file', Buffer.from('MZ\x90\x00 this is a PE binary'), 'invoice.pdf')
    expect(res.status).toBe(415)
    expect(res.body.error).toMatch(/do not match its "\.pdf" extension/)
    expect(store.putStream).not.toHaveBeenCalled()
  })

  it('allows text formats, which have no signature to check', async () => {
    wire()
    const res = await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents')
      .attach('file', Buffer.from('a,b,c\n1,2,3\n'), 'data.csv')
    expect(res.status).toBe(201)
  })
})

/* ---------------------------------------------------------------- *
 * Path traversal — section 12
 * ---------------------------------------------------------------- */
describe('JL-164 filenames cannot escape', () => {
  it('strips path segments from a traversing filename', async () => {
    wire()
    const res = await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents')
      .attach('file', bodyFor('x.pdf'), '../../../etc/passwd.pdf')
    expect(res.status).toBe(201)

    // The stored key is a UUID derived from the Space, never the name.
    const [key] = store.putStream.mock.calls[0]
    expect(key).toMatch(/^doc-7-[0-9a-f-]+\.pdf$/)
    expect(key).not.toMatch(/\.\./)

    // And the display name kept as data carries no separators either.
    const insert = db.run.mock.calls.find(([q]) => /INSERT INTO documents/.test(q))
    expect(insert[1][2]).not.toMatch(/[\\/]/)
    expect(insert[1][2]).not.toMatch(/\.\./)
  })

  it('reads storage by BASENAME on the way out too', async () => {
    wire({ role: 'Viewer', doc: { ...DOC, storage_key: '../../../etc/passwd' } })
    await request(await buildApp(as(MEMBER))).get('/documents/3/download')
    expect(store.get).toHaveBeenCalledWith('passwd')
  })
})

/* ---------------------------------------------------------------- *
 * Temp file hygiene
 * ---------------------------------------------------------------- */
describe('JL-164 the temp file never leaks', () => {
  it('is cleaned up after a REJECTED upload', async () => {
    // A leaked 100 MB temp file per failed upload is its own bug.
    wire()
    await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents')
      .attach('file', bodyFor('bad.exe'), 'bad.exe')
    expect(await tempCount()).toBe(0)
  })

  it('is cleaned up after a SUCCESSFUL upload', async () => {
    wire()
    await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents')
      .attach('file', bodyFor('ok.pdf'), 'ok.pdf')
    expect(await tempCount()).toBe(0)
  })

  it('is cleaned up when the handler throws', async () => {
    wire()
    store.putStream.mockRejectedValue(new Error('storage exploded'))
    await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents')
      .attach('file', bodyFor('ok.pdf'), 'ok.pdf')
      .catch(() => {})
    expect(await tempCount()).toBe(0)
  })

  it('is cleaned up when permission is refused', async () => {
    wire({ role: 'Viewer' })
    await request(await buildApp(as(MEMBER)))
      .post('/spaces/7/documents')
      .attach('file', bodyFor('ok.pdf'), 'ok.pdf')
    expect(await tempCount()).toBe(0)
  })
})

/* ---------------------------------------------------------------- *
 * Size and quota — section 3
 * ---------------------------------------------------------------- */
describe('JL-164 size and storage limits', () => {
  it('refuses a file over a Space-specific cap, quoting THAT cap', async () => {
    // A refusal that quotes 100 MB while enforcing 2 MB tells the user to do
    // something that will fail again.
    wire({ space: { ...SPACE, max_document_bytes: 2 * 1024 * 1024 } })
    const res = await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents')
      .attach('file', bodyFor('big.pdf', 3 * 1024 * 1024), 'big.pdf')
    expect(res.status).toBe(413)
    expect(res.body.error).toBe(
      'File size exceeds the maximum allowed limit of 2 MB. Please select a smaller file.',
    )
    expect(store.putStream).not.toHaveBeenCalled()
  })

  it('refuses once the Space quota is reached', async () => {
    wire({ space: { ...SPACE, storage_limit_bytes: 1000 }, used: 900 })
    const res = await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents')
      .attach('file', bodyFor('x.pdf', 400), 'x.pdf')
    expect(res.status).toBe(507)
    expect(res.body.error).toMatch(/storage limit/i)
  })

  it('counts RETAINED versions against the quota', async () => {
    /*
     * Without this, replacing one file repeatedly grows a Space without
     * limit: each old version still occupies storage but nothing is charged.
     */
    wire()
    await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents')
      .attach('file', bodyFor('x.pdf'), 'x.pdf')
    const [sql] = db.get.mock.calls.find(([q]) => /AS used/.test(q))
    expect(sql).toMatch(/FROM document_versions/)
    expect(sql).toMatch(/version_number <> d\.current_version/)
  })
})

/* ---------------------------------------------------------------- *
 * Permissions — section 11
 * ---------------------------------------------------------------- */
describe('JL-164 permissions map onto Space roles', () => {
  it('404s a Space the caller cannot see, never 403', async () => {
    // `null`, not `undefined`: the default parameter in wire() would swallow
    // undefined and hand back a real Space, passing for the wrong reason.
    wire({ space: null })
    const res = await request(await buildApp(as(STRANGER))).get('/spaces/99/documents')
    expect(res.status).toBe(404)
  })

  it('lets a Viewer list and download but not upload', async () => {
    wire({ role: 'Viewer' })
    expect((await request(await buildApp(as(MEMBER))).get('/spaces/7/documents')).status).toBe(200)

    wire({ role: 'Viewer' })
    const up = await request(await buildApp(as(MEMBER)))
      .post('/spaces/7/documents').attach('file', bodyFor('a.pdf'), 'a.pdf')
    expect(up.status).toBe(403)
  })

  it('lets a Member upload and replace but not delete or move', async () => {
    wire({ role: 'Member' })
    const up = await request(await buildApp(as(MEMBER)))
      .post('/spaces/7/documents').attach('file', bodyFor('a.pdf'), 'a.pdf')
    expect(up.status).toBe(201)

    wire({ role: 'Member' })
    expect((await request(await buildApp(as(MEMBER))).delete('/documents/3')).status).toBe(403)

    wire({ role: 'Member' })
    const move = await request(await buildApp(as(MEMBER))).put('/documents/3').send({ folderId: 4 })
    expect(move.status).toBe(403)
  })

  it('lets a Member rename without being able to move', async () => {
    wire({ role: 'Member' })
    const res = await request(await buildApp(as(MEMBER)))
      .put('/documents/3').send({ fileName: 'Renamed.pdf' })
    expect(res.status).toBe(200)
  })

  it('lets a Space Admin delete, and only soft-deletes', async () => {
    wire({ role: 'Admin' })
    const res = await request(await buildApp(as(MEMBER))).delete('/documents/3')
    expect(res.status).toBe(200)
    const found = db.run.mock.calls.find(([q]) => /UPDATE documents SET deleted_at/.test(q))
    expect(found, 'delete must be soft').toBeTruthy()
    // The stored object survives, so the audit entry stays verifiable.
    expect(store.remove).not.toHaveBeenCalled()
  })

  it('refuses a restore to anyone below Space Admin', async () => {
    wire({ role: 'Member', version: { id: 5, document_id: 3, version_number: 1 } })
    expect((await request(await buildApp(as(MEMBER))).post('/documents/3/restore/5')).status).toBe(403)
  })

  it('refuses an upload to an archived Space', async () => {
    wire({ space: { ...SPACE, archived: true } })
    const res = await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents').attach('file', bodyFor('a.pdf'), 'a.pdf')
    expect(res.status).toBe(409)
  })
})

/* ---------------------------------------------------------------- *
 * Versions — section 10
 * ---------------------------------------------------------------- */
describe('JL-164 replacing never overwrites', () => {
  it('writes a NEW version row and leaves the old object alone', async () => {
    wire({ role: 'Admin' })
    const res = await request(await buildApp(as(OWNER)))
      .post('/documents/3/versions')
      .field('changeComment', 'v3')
      .attach('file', bodyFor('Requirements.pdf'), 'Requirements.pdf')
    expect(res.status).toBe(201)

    const insert = db.run.mock.calls.find(([q]) => /INSERT INTO document_versions/.test(q))
    expect(insert, 'a version row must be written').toBeTruthy()
    expect(insert[1][1], 'version number increments').toBe(3)
    // The old object is never removed — that is what makes "download previous
    // version" possible at all.
    expect(store.remove).not.toHaveBeenCalled()
  })

  it('restores by APPENDING a higher version, not by rewinding', async () => {
    /*
     * History is a record, not a mutable document (JL-108). Rewinding
     * current_version would erase the fact that a restore happened.
     */
    wire({
      role: 'Admin',
      version: {
        id: 5, document_id: 3, version_number: 1, file_name: 'Requirements.pdf',
        file_size: 512, mime_type: 'application/pdf', storage_key: 'doc-7-old.pdf',
        storage_backend: 'local',
      },
    })
    const res = await request(await buildApp(as(OWNER))).post('/documents/3/restore/5')
    expect(res.status).toBe(200)

    const insert = db.run.mock.calls.find(([q]) => /INSERT INTO document_versions/.test(q))
    expect(insert[1][1], 'restore appends version 3, it does not go back to 1').toBe(3)
    expect(insert[1][8]).toMatch(/Restored from version 1/)
  })

  it('404s a version that belongs to another document', async () => {
    wire({ role: 'Admin', version: null })
    expect((await request(await buildApp(as(OWNER))).post('/documents/3/restore/999')).status).toBe(404)
  })
})

/* ---------------------------------------------------------------- *
 * Download and preview — sections 9 and 12
 * ---------------------------------------------------------------- */
describe('JL-164 serving bytes safely', () => {
  it('downloads as an attachment, never inline', async () => {
    wire({ role: 'Viewer' })
    const res = await request(await buildApp(as(MEMBER))).get('/documents/3/download')
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/^attachment;/)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('refuses preview for a type that cannot be shown safely', async () => {
    wire({ role: 'Viewer', doc: { ...DOC, file_extension: 'zip' } })
    const res = await request(await buildApp(as(MEMBER))).get('/documents/3/preview')
    expect(res.status).toBe(415)
    expect(res.body.error).toBe(
      'Preview not available for this file type. Download the document to view it.',
    )
  })

  it('does NOT preview an SVG inline', async () => {
    // Uploadable, but an inline SVG on this origin is stored XSS.
    wire({ role: 'Viewer', doc: { ...DOC, file_extension: 'svg' } })
    expect((await request(await buildApp(as(MEMBER))).get('/documents/3/preview')).status).toBe(415)
  })

  it('previews a PDF inline, sandboxed', async () => {
    wire({ role: 'Viewer', doc: { ...DOC, file_extension: 'pdf' } })
    const res = await request(await buildApp(as(MEMBER))).get('/documents/3/preview')
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/^inline;/)
    expect(res.headers['content-security-policy']).toMatch(/sandbox/)
  })

  it('serves a text preview as text/plain whatever it claimed to be', async () => {
    // An .xml served as markup and rendered would be script on this origin.
    wire({ role: 'Viewer', doc: { ...DOC, file_extension: 'xml', mime_type: 'application/xml' } })
    const res = await request(await buildApp(as(MEMBER))).get('/documents/3/preview')
    expect(res.headers['content-type']).toMatch(/text\/plain/)
  })

  it('says so when the row outlives the stored object', async () => {
    wire({ role: 'Viewer' })
    store.get.mockRejectedValue(new Error('ENOENT'))
    const res = await request(await buildApp(as(MEMBER))).get('/documents/3/download')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/no longer stored/)
  })
})

/* ---------------------------------------------------------------- *
 * Malware hook — section 12
 * ---------------------------------------------------------------- */
describe('JL-164 malware scanning', () => {
  it('refuses a body carrying the EICAR signature', async () => {
    const { EICAR_SIGNATURE } = await import('../services/virusScan.js')
    wire()
    const res = await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents')
      .attach('file', Buffer.from(EICAR_SIGNATURE), 'test.txt')
    expect(res.status).toBe(422)
    expect(store.putStream, 'an infected body must never be stored').not.toHaveBeenCalled()
    /*
     * Deliberately NOT asserting the temp file is gone here, unlike the four
     * cleanup tests above.
     *
     * On a host with live anti-virus the EICAR file is locked or quarantined
     * the instant multer writes it, so our unlink fails and the file lingers —
     * observed on Windows with Defender. The cleanup code is correct (it
     * attempts the unlink and tolerates failure); the operating system is
     * simply refusing, and asserting otherwise would make this suite fail on
     * exactly the machines where AV is doing its job.
     *
     * The same lock is why the route answers 422 rather than 500: acceptUpload
     * treats an unreadable temp file as a rejection.
     */
  })
})

/* ---------------------------------------------------------------- *
 * Duplicates, folders, listing — sections 4, 7, 8
 * ---------------------------------------------------------------- */
describe('JL-164 duplicates and folders', () => {
  it('reports a duplicate name in the same folder', async () => {
    wire({ duplicate: { id: 9 } })
    const res = await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents').attach('file', bodyFor('Requirements.pdf'), 'Requirements.pdf')
    expect(res.status).toBe(409)
    expect(res.body.existingDocumentId).toBe(9)
  })

  it('refuses to delete a folder that still holds documents', async () => {
    /*
     * documents.folder_id is ON DELETE SET NULL, so deleting a full folder
     * would tip its documents back into the Space root rather than delete
     * them — neither outcome the person clicking delete has in mind.
     */
    wire({ role: 'Admin', folder: { id: 4, space_id: 7, folder_name: 'Design' }, docCount: 2 })
    const res = await request(await buildApp(as(OWNER))).delete('/folders/4')
    expect(res.status).toBe(409)
    expect(res.body.documentCount).toBe(2)
  })

  it('refuses to nest a folder inside itself', async () => {
    wire({ role: 'Admin', folder: { id: 4, space_id: 7, parent_folder_id: null } })
    const res = await request(await buildApp(as(OWNER))).put('/folders/4').send({ parentFolderId: 4 })
    expect(res.status).toBe(400)
  })

  it('paginates the listing and reports storage usage', async () => {
    wire({ role: 'Viewer', used: 2048 })
    const res = await request(await buildApp(as(MEMBER))).get('/spaces/7/documents?limit=2')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('hasMore')
    expect(res.body.storage.usedBytes).toBe(2048)
    expect(res.body.storage.limitBytes).toBeGreaterThan(0)
  })

  it('narrows by folder, type and uploader on top of the Space scope', async () => {
    wire({ role: 'Viewer' })
    await request(await buildApp(as(MEMBER)))
      .get('/spaces/7/documents?fileType=pdf&uploadedBy=a@b.c&folderId=4')
    const [sql, params] = db.all.mock.calls.find(([q]) => /FROM documents d/.test(q))
    expect(sql).toMatch(/d\.space_id = \?/)
    expect(sql).toMatch(/d\.deleted_at IS NULL/)
    expect(params[0], 'the Space is always the first bound param').toBe(7)
  })

  it('never interpolates a caller-supplied sort column', async () => {
    // The ORDER BY column is interpolated, so it must come from an allowlist.
    wire({ role: 'Viewer' })
    await request(await buildApp(as(MEMBER))).get('/spaces/7/documents?sort=;DROP TABLE documents;--')
    const [sql] = db.all.mock.calls.find(([q]) => /FROM documents d/.test(q))
    expect(sql).not.toMatch(/DROP TABLE/)
    expect(sql).toMatch(/ORDER BY d\.uploaded_at DESC/)
  })
})

/* ---------------------------------------------------------------- *
 * Audit — sections 12 and 16
 * ---------------------------------------------------------------- */
describe('JL-164 audit trail', () => {
  it('records uploads and downloads', async () => {
    wire()
    await request(await buildApp(as(OWNER)))
      .post('/spaces/7/documents').attach('file', bodyFor('a.pdf'), 'a.pdf')
    expect(audit.safeAppendAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.uploaded', actor: OWNER }),
    )

    vi.clearAllMocks()
    wire({ role: 'Viewer' })
    await request(await buildApp(as(MEMBER))).get('/documents/3/download')
    expect(audit.safeAppendAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.downloaded' }),
    )
  })

  it('does not audit a refused upload', async () => {
    wire({ role: 'Viewer' })
    await request(await buildApp(as(MEMBER)))
      .post('/spaces/7/documents').attach('file', bodyFor('a.pdf'), 'a.pdf')
    expect(audit.safeAppendAudit).not.toHaveBeenCalled()
  })
})
