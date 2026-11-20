// @vitest-environment node
// Project logos: who may set them (the same people who may change project
// settings: project Admin/Lead or workspace Admin/Owner), what is accepted (a
// real PNG/JPEG/GIF/WebP by its bytes, at most 1 MB — never SVG or a disguised
// file), how they are served (sniffed type + nosniff, read-gated), and that
// clients never see the storage key.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { makeDbMock } from './helpers/mockDb.js'

vi.mock('../db.js', () => makeDbMock())
const storage = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), remove: vi.fn() }))
vi.mock('../services/storage.js', () => ({ getStorage: () => storage }))
vi.mock('../services/workflowSeed.js', () => ({ seedDefaultWorkflow: vi.fn() }))
vi.mock('./../routes/workspaceSettings.js', () => ({ getProjectCreationPolicy: vi.fn(async () => 'all_members') }))

import { run, get, all } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { sniffImageType, withLogoUrl, MAX_LOGO_BYTES } from '../services/projectLogo.js'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)])
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32, 3)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32, 4)])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const b64 = (buf) => buf.toString('base64')

// Users by workspace role and their role in project 7 (project_members).
const USERS = {
  wsAdmin: { id: 1, email: 'admin@x.com', memberId: 1, workspaceRole: 'Admin', isOwner: false, projectRole: null },
  lead: { id: 2, email: 'lead@x.com', memberId: 2, workspaceRole: 'Member', isOwner: false, projectRole: 'Lead' },
  projAdmin: { id: 3, email: 'padmin@x.com', memberId: 3, workspaceRole: 'Viewer', isOwner: false, projectRole: 'Admin' },
  projMember: { id: 4, email: 'member@x.com', memberId: 4, workspaceRole: 'Member', isOwner: false, projectRole: 'Member' },
  outsider: { id: 5, email: 'out@x.com', memberId: 5, workspaceRole: 'Member', isOwner: false, projectRole: null },
}

let project
let app
beforeEach(async () => {
  vi.clearAllMocks()
  project = { id: 7, name: 'Proj', key: 'PRJ', lead_member_id: null, logo_key: null, logo_mime: null, logo_updated_at: null }
  storage.put.mockResolvedValue(undefined)
  storage.remove.mockResolvedValue(undefined)
  storage.get.mockResolvedValue(PNG)
  get.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM project_members WHERE project_id')) {
      const u = Object.values(USERS).find((x) => x.memberId === params[1])
      return u?.projectRole ? { role: u.projectRole } : undefined
    }
    if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) {
      const u = Object.values(USERS).find((x) => x.memberId === params[0])
      return { id: 7, lead_member_id: null, project_role: u?.projectRole || null }
    }
    if (sql.includes('FROM projects WHERE id')) return Number(params[0]) === 7 ? { ...project } : undefined
    return undefined
  })
  all.mockResolvedValue([])
  run.mockImplementation(async (sql, params) => {
    if (sql.startsWith('UPDATE projects SET logo_key')) {
      project.logo_key = params[0]
      project.logo_mime = params[1] ?? null
      project.logo_updated_at = new Date('2026-11-20T10:00:00Z')
    }
    return { lastID: 1, changes: 1 }
  })

  const { default: projects } = await import('../routes/projects.js')
  app = express()
  app.use(express.json({ limit: '25mb' }))
  app.use((req, _res, next) => {
    req.user = { ...USERS[req.headers['x-as'] || 'wsAdmin'] }
    delete req.user.projectRole
    next()
  })
  app.use('/api/projects', projects)
  app.use(errorHandler)
})

const upload = (as, buf, extra = {}) =>
  request(app).post('/api/projects/7/logo').set('x-as', as).send({ filename: 'logo.png', dataBase64: b64(buf), ...extra })

describe('who may change the logo', () => {
  for (const as of ['wsAdmin', 'lead', 'projAdmin']) {
    it(`${as} may upload`, async () => {
      const res = await upload(as, PNG)
      expect(res.status).toBe(201)
      expect(storage.put).toHaveBeenCalledTimes(1)
    })
  }

  for (const as of ['projMember', 'outsider']) {
    it(`${as} may not upload or remove (403), and nothing is stored`, async () => {
      expect((await upload(as, PNG)).status).toBe(403)
      expect((await request(app).delete('/api/projects/7/logo').set('x-as', as)).status).toBe(403)
      expect(storage.put).not.toHaveBeenCalled()
      expect(run).not.toHaveBeenCalled()
    })
  }
})

describe('upload', () => {
  it('stores the image under its sniffed type and returns logo_url, never the storage key', async () => {
    const res = await upload('lead', JPEG, { mime: 'image/png' }) // the declared type is ignored
    expect(res.status).toBe(201)
    const [key, buf, mime] = storage.put.mock.calls[0]
    expect(key).toMatch(/^project-logo-7-\d+-[0-9a-f]{12}\.jpeg$/)
    expect(buf.equals(JPEG)).toBe(true)
    expect(mime).toBe('image/jpeg')
    expect(res.body.logo_url).toBe(`/api/projects/7/logo?v=${new Date('2026-11-20T10:00:00Z').getTime()}`)
    expect(res.body).not.toHaveProperty('logo_key')
    expect(res.body).not.toHaveProperty('logo_mime')
  })

  it('accepts PNG, JPEG, GIF and WebP', async () => {
    for (const buf of [PNG, JPEG, GIF, WEBP]) expect((await upload('wsAdmin', buf)).status).toBe(201)
  })

  it('refuses SVG, and anything that is not really an image whatever it is called', async () => {
    for (const buf of [SVG, Buffer.from('<html><script>x</script></html>padding-padding')]) {
      const res = await upload('wsAdmin', buf, { filename: 'logo.png', mime: 'image/png' })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Project logo must be a PNG, JPEG, GIF or WebP image')
    }
    expect(storage.put).not.toHaveBeenCalled()
  })

  it('refuses an empty upload and one over 1 MB', async () => {
    expect((await request(app).post('/api/projects/7/logo').send({})).status).toBe(400)
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)])
    const res = await upload('wsAdmin', big)
    expect(res.status).toBe(413)
    expect(storage.put).not.toHaveBeenCalled()
  })

  it('replacing a logo deletes the old file', async () => {
    project.logo_key = 'project-logo-7-old.png'
    expect((await upload('wsAdmin', PNG)).status).toBe(201)
    expect(storage.remove).toHaveBeenCalledWith('project-logo-7-old.png')
  })

  it('404 for a project that does not exist', async () => {
    const res = await request(app).post('/api/projects/999/logo').send({ dataBase64: b64(PNG) })
    expect(res.status).toBe(404)
  })
})

describe('remove', () => {
  it('clears the logo and deletes the file', async () => {
    project.logo_key = 'project-logo-7-a.png'
    const res = await request(app).delete('/api/projects/7/logo').set('x-as', 'projAdmin')
    expect(res.status).toBe(200)
    expect(run.mock.calls.some(([sql]) => sql.startsWith('UPDATE projects SET logo_key = NULL'))).toBe(true)
    expect(storage.remove).toHaveBeenCalledWith('project-logo-7-a.png')
  })
})

describe('serving the logo', () => {
  it('streams it with the sniffed type and nosniff to anyone who can read the project', async () => {
    project.logo_key = 'k.png'
    project.logo_mime = 'image/png'
    const res = await request(app).get('/api/projects/7/logo').set('x-as', 'projMember')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('is refused to someone outside the project', async () => {
    project.logo_key = 'k.png'
    const res = await request(app).get('/api/projects/7/logo').set('x-as', 'outsider')
    expect(res.status).toBe(403)
    expect(storage.get).not.toHaveBeenCalled()
  })

  it('404 when there is no logo', async () => {
    expect((await request(app).get('/api/projects/7/logo')).status).toBe(404)
  })

  it('GET /api/projects/:id carries logo_url and hides the storage key', async () => {
    project.logo_key = 'k.png'
    project.logo_updated_at = new Date(1000)
    const res = await request(app).get('/api/projects/7')
    expect(res.body.logo_url).toBe('/api/projects/7/logo?v=1000')
    expect(res.body).not.toHaveProperty('logo_key')
  })
})

describe('helpers', () => {
  it('sniffImageType reads the bytes', () => {
    expect(sniffImageType(PNG)).toBe('image/png')
    expect(sniffImageType(JPEG)).toBe('image/jpeg')
    expect(sniffImageType(GIF)).toBe('image/gif')
    expect(sniffImageType(WEBP)).toBe('image/webp')
    expect(sniffImageType(SVG)).toBeNull()
    expect(sniffImageType(Buffer.alloc(3))).toBeNull()
  })

  it('withLogoUrl gives null when there is no logo', () => {
    expect(withLogoUrl({ id: 3, logo_key: null })).toEqual({ id: 3, logo_url: null })
  })
})
