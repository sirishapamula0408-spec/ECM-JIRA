// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  selectBackend,
  LocalStorage,
  S3Storage,
  getStorage,
} from '../services/storage.js'
import { scanBuffer, EICAR_SIGNATURE } from '../services/virusScan.js'

// ---- Mock db.js for the upload route test ----
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule) {
  const app = express()
  app.use(express.json({ limit: '25mb' }))
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: true }
    next()
  })
  app.use('/api', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   selectBackend — PURE, no AWS
   ================================================================ */
describe('selectBackend', () => {
  it("returns 'local' when no S3 config present", () => {
    expect(selectBackend({})).toBe('local')
    expect(selectBackend()).toBe('local')
  })

  it("returns 'local' when config is partial", () => {
    expect(selectBackend({ bucket: 'b', region: 'r' })).toBe('local')
    expect(selectBackend({ bucket: 'b', region: 'r', accessKeyId: 'k' })).toBe('local')
  })

  it("returns 's3' when all required S3 config present", () => {
    expect(
      selectBackend({
        bucket: 'my-bucket',
        region: 'us-east-1',
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
      }),
    ).toBe('s3')
  })

  it("treats endpoint as optional (still 's3' without it)", () => {
    expect(
      selectBackend({
        bucket: 'b',
        region: 'r',
        accessKeyId: 'k',
        secretAccessKey: 's',
        endpoint: '',
      }),
    ).toBe('s3')
  })
})

/* ================================================================
   getStorage factory
   ================================================================ */
describe('getStorage', () => {
  it('returns LocalStorage when unconfigured', () => {
    const s = getStorage({})
    expect(s).toBeInstanceOf(LocalStorage)
    expect(s.backend).toBe('local')
  })

  it('returns S3Storage when fully configured', () => {
    const s = getStorage({
      bucket: 'b',
      region: 'r',
      accessKeyId: 'k',
      secretAccessKey: 's',
    })
    expect(s).toBeInstanceOf(S3Storage)
    expect(s.backend).toBe('s3')
  })
})

/* ================================================================
   LocalStorage put/get/remove round-trip (temp dir)
   ================================================================ */
describe('LocalStorage round-trip', () => {
  let dir
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jl137-'))
  })
  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it('puts, gets and removes a buffer', async () => {
    const storage = new LocalStorage({ dir })
    const key = 'test-key.bin'
    const payload = Buffer.from('hello storage world', 'utf8')

    await storage.put(key, payload, 'application/octet-stream')
    const got = await storage.get(key)
    expect(Buffer.compare(got, payload)).toBe(0)

    await storage.remove(key)
    await expect(storage.get(key)).rejects.toBeDefined()
  })

  it('remove is idempotent (no throw on missing key)', async () => {
    const storage = new LocalStorage({ dir })
    await expect(storage.remove('nope.bin')).resolves.toBeUndefined()
  })

  it('guards against path traversal in keys', async () => {
    const storage = new LocalStorage({ dir })
    await storage.put('../escape.bin', Buffer.from('x'), 'text/plain')
    // Written as basename inside dir, not outside it.
    const entries = await fs.readdir(dir)
    expect(entries).toContain('escape.bin')
  })
})

/* ================================================================
   S3Storage (mocked client — never hits AWS)
   ================================================================ */
describe('S3Storage (mocked client)', () => {
  it('sends PutObject/GetObject/DeleteObject via injected client', async () => {
    const send = vi.fn(async (cmd) => {
      if (cmd?.constructor?.name === 'GetObjectCommand') {
        return { Body: Buffer.from('s3 payload') }
      }
      return {}
    })
    const storage = new S3Storage(
      { bucket: 'b', region: 'r', accessKeyId: 'k', secretAccessKey: 's' },
      { client: { send } },
    )
    await storage.put('k1', Buffer.from('data'), 'text/plain')
    const got = await storage.get('k1')
    expect(got.toString()).toBe('s3 payload')
    await storage.remove('k1')
    expect(send).toHaveBeenCalledTimes(3)
  })
})

/* ================================================================
   Virus scan
   ================================================================ */
describe('scanBuffer', () => {
  it('flags an EICAR test signature as not clean', async () => {
    const res = await scanBuffer(Buffer.from(EICAR_SIGNATURE, 'latin1'))
    expect(res.clean).toBe(false)
    expect(res.reason).toMatch(/EICAR/i)
  })

  it('passes normal content', async () => {
    const res = await scanBuffer(Buffer.from('a perfectly innocent file', 'utf8'))
    expect(res.clean).toBe(true)
  })

  it('treats empty buffer as clean', async () => {
    const res = await scanBuffer(Buffer.alloc(0))
    expect(res.clean).toBe(true)
  })
})

/* ================================================================
   Upload route — rejects infected buffer with 422
   ================================================================ */
describe('POST attachments upload — virus scan gate', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/attachments.js')
    app = createApp(mod)
  })

  it('rejects an infected (EICAR) upload with 422', async () => {
    get.mockResolvedValue({ id: 5 }) // issue exists
    const dataBase64 = Buffer.from(EICAR_SIGNATURE, 'latin1').toString('base64')

    const res = await request(app)
      .post('/api/issues/5/attachments')
      .send({ filename: 'evil.txt', mime: 'text/plain', dataBase64 })

    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/virus scan/i)
    // Nothing should have been written to the DB.
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 when issue does not exist', async () => {
    get.mockResolvedValue(undefined)
    const res = await request(app)
      .post('/api/issues/999/attachments')
      .send({ filename: 'x.txt', mime: 'text/plain', dataBase64: Buffer.from('hi').toString('base64') })
    expect(res.status).toBe(404)
  })
})
