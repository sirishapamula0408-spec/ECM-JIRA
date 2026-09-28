// @vitest-environment node
/* ================================================================
   JL-125→127 + JL-130 — templates, and recently-modified pages.
   ================================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const db = { run: vi.fn(), get: vi.fn(), all: vi.fn(), tableExists: vi.fn(), columnExists: vi.fn() }
vi.mock('../db.js', () => db)

const { roleGate } = vi.hoisted(() => ({ roleGate: { admin: true } }))
vi.mock('../middleware/authorize.js', () => ({
  // requireRole('Admin') is the real gate; this stands in for it so the
  // route's OWN behaviour can be tested either side of it.
  requireRole: (role) => (req, res, next) => {
    if (role === 'Admin' && !roleGate.admin) {
      res.status(403).json({ error: 'Admin required' })
      return
    }
    next()
  },
  loadProjectRole: () => (req, _res, next) => next(),
  requireProjectRole: () => (req, _res, next) => next(),
  loadUserRoles: (req, _res, next) => next(),
}))

const ME = 'me@x.com'

const template = (over = {}) => ({
  id: 1, template_key: 'sop', name: 'Standard Operating Procedure',
  description: 'A repeatable procedure.', body: '<h2>Purpose</h2>',
  is_builtin: true, created_by: null, updated_by: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over,
})

async function buildApp(user = { id: 1, email: ME }) {
  const mod = await import('../routes/wikiTemplates.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use('/', mod.default)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  roleGate.admin = true
  db.all.mockResolvedValue([template()])
  db.get.mockResolvedValue(template())
  db.run.mockResolvedValue({ lastID: 9, changes: 1 })
})

/* ---------------------------------------------------------------- *
 * JL-126 — the shipped set
 * ---------------------------------------------------------------- */
describe('JL-126 the seven standard templates', () => {
  it('ships exactly seven, each with a key, a name and a body', async () => {
    const { BUILTIN_TEMPLATES } = await import('../utils/builtinTemplates.js')
    expect(BUILTIN_TEMPLATES).toHaveLength(7)
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.key, 'every template needs a stable key for the reseed').toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.body.length).toBeGreaterThan(50)
    }
  })

  it('covers the seven the ticket names', async () => {
    const { BUILTIN_TEMPLATES } = await import('../utils/builtinTemplates.js')
    expect(BUILTIN_TEMPLATES.map((t) => t.key).sort()).toEqual([
      'decision-record', 'deployment-procedure', 'knowledge-article',
      'meeting-notes', 'problem-resolution', 'sop', 'technical-documentation',
    ])
  })

  it('survives sanitizeHtml UNCHANGED', async () => {
    /*
     * Templates are stored as page content, so they go through the same
     * sanitiser. A template using a tag the allow-list drops would silently
     * lose its structure the first time somebody used it — and the loss would
     * show up in a new page, not here.
     */
    const { BUILTIN_TEMPLATES } = await import('../utils/builtinTemplates.js')
    const { sanitizeHtml } = await import('../../src/utils/sanitizeHtml.js')
    for (const t of BUILTIN_TEMPLATES) {
      expect(sanitizeHtml(t.body), `${t.key} is altered by the sanitiser`).toBe(t.body)
    }
  })

  it('uses prompts, not placeholder prose that could ship as real', async () => {
    const { BUILTIN_TEMPLATES } = await import('../utils/builtinTemplates.js')
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.body.toLowerCase()).not.toContain('lorem')
      // Each section states what belongs there, in italics.
      expect(t.body).toMatch(/<em>/)
    }
  })
})

/* ---------------------------------------------------------------- *
 * JL-125 / JL-127 — the API
 * ---------------------------------------------------------------- */
describe('JL-125 listing is open to anyone who can read the wiki', () => {
  it('lists templates without requiring admin', async () => {
    roleGate.admin = false
    const res = await request(await buildApp()).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('404s an unknown template', async () => {
    db.get.mockResolvedValue(null)
    const res = await request(await buildApp()).get('/999')
    expect(res.status).toBe(404)
  })
})

describe('JL-127 admin management', () => {
  it('creates a custom template', async () => {
    const res = await request(await buildApp()).post('/').send({ name: 'Runbook', body: '<h2>x</h2>' })
    expect(res.status).toBe(201)
    const insert = db.run.mock.calls.find((c) => /INSERT INTO wiki_templates/.test(c[0]))
    // NULL key and is_builtin FALSE: a custom template is never reseeded.
    expect(insert[0]).toMatch(/VALUES \(NULL, \?, \?, \?, FALSE/)
  })

  it('refuses a create from a non-admin', async () => {
    roleGate.admin = false
    const res = await request(await buildApp()).post('/').send({ name: 'x' })
    expect(res.status).toBe(403)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('requires a name', async () => {
    const res = await request(await buildApp()).post('/').send({ body: 'x' })
    expect(res.status).toBe(400)
  })

  it('EDITS a built-in, so a team keeps its reshaped SOP', async () => {
    db.get.mockResolvedValue(template({ is_builtin: true }))
    const res = await request(await buildApp()).patch('/1').send({ body: '<h2>Ours</h2>' })
    expect(res.status).toBe(200)
    expect(db.run.mock.calls.some((c) => /UPDATE wiki_templates SET/.test(c[0]))).toBe(true)
  })

  it('REFUSES to delete a built-in, rather than letting it reappear', async () => {
    /*
     * The boot seed is ON CONFLICT DO NOTHING keyed on template_key, so a
     * deleted built-in would silently return on the next restart. A delete
     * that does not stay deleted is worse than one declined with a reason.
     */
    db.get.mockResolvedValue(template({ is_builtin: true }))
    const res = await request(await buildApp()).delete('/1')
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/restored on the next restart/i)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('deletes a custom one', async () => {
    db.get.mockResolvedValue(template({ id: 2, template_key: null, is_builtin: false }))
    const res = await request(await buildApp()).delete('/2')
    expect(res.status).toBe(200)
    expect(db.run.mock.calls.some((c) => /DELETE FROM wiki_templates/.test(c[0]))).toBe(true)
  })

  it('records who last changed it', async () => {
    await request(await buildApp({ id: 2, email: 'editor@x.com' })).patch('/1').send({ name: 'New' })
    const update = db.run.mock.calls.find((c) => /UPDATE wiki_templates SET/.test(c[0]))
    expect(update[0]).toMatch(/updated_by = \?/)
    expect(update[1]).toContain('editor@x.com')
  })
})
