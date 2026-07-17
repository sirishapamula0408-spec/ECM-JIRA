// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import {
  EXTENSION_POINTS,
  validateManifest,
  contributionsFor,
  isSafeUrl,
} from '../services/pluginRegistry.js'

function createApp(routeModule, role = 'Admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: role, isOwner: false }
    next()
  })
  app.use('/api/plugins', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let mod
beforeEach(async () => {
  vi.clearAllMocks()
  mod = await import('../routes/plugins.js')
})

/* ============ Pure: validateManifest ============ */
describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const res = validateManifest({
      name: 'My App',
      contributions: [
        { extensionPoint: 'nav-item', id: 'nav1', label: 'Open App', url: '/apps/mine' },
        { extensionPoint: 'issue-panel', id: 'p1', label: 'Details', url: 'https://example.com' },
      ],
    })
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])
  })

  it('rejects an unknown extension point', () => {
    const res = validateManifest({
      name: 'App',
      contributions: [{ extensionPoint: 'bogus-point', id: 'x', label: 'X' }],
    })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/extension point/i)
  })

  it('rejects a missing label', () => {
    const res = validateManifest({
      name: 'App',
      contributions: [{ extensionPoint: 'nav-item', id: 'x' }],
    })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/label is required/i)
  })

  it('rejects a missing id', () => {
    const res = validateManifest({
      name: 'App',
      contributions: [{ extensionPoint: 'nav-item', label: 'X' }],
    })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/id is required/i)
  })

  it('rejects a missing name', () => {
    const res = validateManifest({ contributions: [] })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/name is required/i)
  })

  it('rejects a javascript: url', () => {
    const res = validateManifest({
      name: 'Evil',
      contributions: [{ extensionPoint: 'nav-item', id: 'e', label: 'Evil', url: 'javascript:alert(1)' }],
    })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/safe url/i)
  })
})

describe('isSafeUrl', () => {
  it('accepts http(s) and relative paths, rejects unsafe schemes', () => {
    expect(isSafeUrl('https://example.com')).toBe(true)
    expect(isSafeUrl('http://example.com/x')).toBe(true)
    expect(isSafeUrl('/apps/mine')).toBe(true)
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeUrl('data:text/html,x')).toBe(false)
    expect(isSafeUrl('//evil.com')).toBe(false)
    expect(isSafeUrl('')).toBe(false)
  })
})

/* ============ Pure: contributionsFor ============ */
describe('contributionsFor', () => {
  const manifests = [
    {
      id: 1, app_key: 'a', enabled: true,
      contributions: [
        { extensionPoint: 'nav-item', id: 'n1', label: 'Nav One', url: '/one' },
        { extensionPoint: 'issue-panel', id: 'p1', label: 'Panel One' },
      ],
    },
    {
      id: 2, app_key: 'b', enabled: false,
      contributions: [{ extensionPoint: 'nav-item', id: 'n2', label: 'Nav Two', url: '/two' }],
    },
    {
      id: 3, app_key: 'c', enabled: true,
      contributions: [{ extensionPoint: 'nav-item', id: 'n3', label: 'Nav Three', url: '/three' }],
    },
  ]

  it('merges enabled manifests contributions for a point', () => {
    const navs = contributionsFor(manifests, 'nav-item')
    expect(navs.map((c) => c.id)).toEqual(['n1', 'n3'])
  })

  it('skips disabled manifests', () => {
    const navs = contributionsFor(manifests, 'nav-item')
    expect(navs.find((c) => c.id === 'n2')).toBeUndefined()
  })

  it('filters by the requested extension point only', () => {
    const panels = contributionsFor(manifests, 'issue-panel')
    expect(panels.map((c) => c.id)).toEqual(['p1'])
  })

  it('parses contributions provided as a JSON string', () => {
    const rows = [{ id: 9, enabled: true, contributions: JSON.stringify([
      { extensionPoint: 'nav-item', id: 's1', label: 'Str' },
    ]) }]
    expect(contributionsFor(rows, 'nav-item').map((c) => c.id)).toEqual(['s1'])
  })

  it('drops contributions with unsafe urls', () => {
    const rows = [{ id: 1, enabled: true, contributions: [
      { extensionPoint: 'nav-item', id: 'bad', label: 'Bad', url: 'javascript:alert(1)' },
    ] }]
    expect(contributionsFor(rows, 'nav-item')).toEqual([])
  })
})

/* ============ Route: POST /api/plugins ============ */
describe('POST /api/plugins', () => {
  it('registers a valid manifest (Admin)', async () => {
    const app = createApp(mod)
    run.mockResolvedValueOnce({ lastID: 5 })
    get.mockResolvedValueOnce({
      id: 5, app_key: null, name: 'My App', version: '1.0.0',
      contributions: [{ extensionPoint: 'nav-item', id: 'n1', label: 'Open' }],
      enabled: true, created_at: 'now',
    })
    const res = await request(app).post('/api/plugins').send({
      name: 'My App',
      contributions: [{ extensionPoint: 'nav-item', id: 'n1', label: 'Open', url: '/x' }],
    })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('My App')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('returns 403 for a non-Admin', async () => {
    const app = createApp(mod, 'Member')
    const res = await request(app).post('/api/plugins').send({ name: 'X', contributions: [] })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid manifest', async () => {
    const app = createApp(mod)
    const res = await request(app).post('/api/plugins').send({
      name: 'Bad',
      contributions: [{ extensionPoint: 'nope', id: 'x', label: 'X' }],
    })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 400 on a javascript: url contribution', async () => {
    const app = createApp(mod)
    const res = await request(app).post('/api/plugins').send({
      name: 'Bad',
      contributions: [{ extensionPoint: 'nav-item', id: 'x', label: 'X', url: 'javascript:alert(1)' }],
    })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })
})

/* ============ Route: GET contributions/:extensionPoint ============ */
describe('GET /api/plugins/contributions/:extensionPoint', () => {
  it('returns only that point enabled contributions', async () => {
    const app = createApp(mod)
    all.mockResolvedValueOnce([
      { id: 1, app_key: 'a', enabled: true, contributions: [
        { extensionPoint: 'nav-item', id: 'n1', label: 'Nav', url: '/n' },
        { extensionPoint: 'issue-panel', id: 'p1', label: 'Panel' },
      ] },
    ])
    const res = await request(app).get('/api/plugins/contributions/nav-item')
    expect(res.status).toBe(200)
    expect(res.body.map((c) => c.id)).toEqual(['n1'])
  })

  it('returns 400 for an unknown extension point', async () => {
    const app = createApp(mod)
    const res = await request(app).get('/api/plugins/contributions/made-up')
    expect(res.status).toBe(400)
  })
})

/* ============ Route: GET /api/plugins ============ */
describe('GET /api/plugins', () => {
  it('lists manifests', async () => {
    const app = createApp(mod)
    all.mockResolvedValueOnce([
      { id: 1, app_key: null, name: 'A', version: '1.0.0', contributions: [], enabled: true, created_at: 'now' },
    ])
    const res = await request(app).get('/api/plugins')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('A')
  })
})

/* ============ Route: PATCH / DELETE (Admin) ============ */
describe('PATCH /api/plugins/:id', () => {
  it('toggles enabled for an Admin', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({ id: 3, name: 'A', contributions: [], enabled: true })
    run.mockResolvedValueOnce({ changes: 1 })
    get.mockResolvedValueOnce({ id: 3, app_key: null, name: 'A', version: '1.0.0', contributions: [], enabled: false, created_at: 'now' })
    const res = await request(app).patch('/api/plugins/3').send({ enabled: false })
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
  })

  it('blocks a non-Admin with 403', async () => {
    const app = createApp(mod, 'Viewer')
    const res = await request(app).patch('/api/plugins/3').send({ enabled: false })
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/plugins/:id', () => {
  it('deletes for an Admin', async () => {
    const app = createApp(mod)
    run.mockResolvedValueOnce({ changes: 1 })
    const res = await request(app).delete('/api/plugins/3')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('blocks a non-Admin with 403', async () => {
    const app = createApp(mod, 'Member')
    const res = await request(app).delete('/api/plugins/3')
    expect(res.status).toBe(403)
  })
})

describe('EXTENSION_POINTS', () => {
  it('includes the five defined points', () => {
    expect(EXTENSION_POINTS).toEqual(['issue-panel', 'nav-item', 'issue-action', 'dashboard-gadget', 'webhook'])
  })
})
