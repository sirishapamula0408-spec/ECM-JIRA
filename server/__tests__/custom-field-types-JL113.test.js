import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, mountPath = '/api') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/customFields.js')
  app = createApp(mod)
})

// Helper: mock the created row returned by `get` after an insert
function mockCreated(row) {
  run.mockResolvedValue({ lastID: row.id })
  get.mockResolvedValue(row)
}

/* ============================ definition creation ============================ */
describe('JL-113 — defining extended field types', () => {
  it('accepts multi_select with options', async () => {
    mockCreated({ id: 10, project_id: 1, name: 'Tags', field_type: 'multi_select', options: JSON.stringify(['a', 'b']), config: null })
    const res = await request(app).post('/api/projects/1/custom-fields')
      .send({ name: 'Tags', fieldType: 'multi_select', options: ['a', 'b'] })
    expect(res.status).toBe(201)
    expect(res.body.fieldType).toBe('multi_select')
    expect(res.body.options).toEqual(['a', 'b'])
  })

  it('rejects multi_select without options', async () => {
    const res = await request(app).post('/api/projects/1/custom-fields')
      .send({ name: 'Tags', fieldType: 'multi_select', options: [] })
    expect(res.status).toBe(400)
  })

  it('accepts labels (free multi values, no options required)', async () => {
    mockCreated({ id: 11, project_id: 1, name: 'Free', field_type: 'labels', options: '[]', config: null })
    const res = await request(app).post('/api/projects/1/custom-fields')
      .send({ name: 'Free', fieldType: 'labels' })
    expect(res.status).toBe(201)
    expect(res.body.fieldType).toBe('labels')
  })

  it('accepts user_picker', async () => {
    mockCreated({ id: 12, project_id: 1, name: 'Owner', field_type: 'user_picker', options: '[]', config: null })
    const res = await request(app).post('/api/projects/1/custom-fields')
      .send({ name: 'Owner', fieldType: 'user_picker' })
    expect(res.status).toBe(201)
    expect(res.body.fieldType).toBe('user_picker')
  })

  it('accepts cascading_select with config.cascade', async () => {
    const cascade = [{ parent: 'P1', children: ['C1', 'C2'] }]
    mockCreated({ id: 13, project_id: 1, name: 'Region', field_type: 'cascading_select', options: '[]', config: JSON.stringify({ cascade }) })
    const res = await request(app).post('/api/projects/1/custom-fields')
      .send({ name: 'Region', fieldType: 'cascading_select', config: { cascade } })
    expect(res.status).toBe(201)
    expect(res.body.config.cascade).toEqual(cascade)
  })

  it('rejects cascading_select without config.cascade', async () => {
    const res = await request(app).post('/api/projects/1/custom-fields')
      .send({ name: 'Region', fieldType: 'cascading_select' })
    expect(res.status).toBe(400)
  })

  it('accepts calculated with config.formula', async () => {
    mockCreated({ id: 14, project_id: 1, name: 'Total', field_type: 'calculated', options: '[]', config: JSON.stringify({ formula: '{5} + {6}' }) })
    const res = await request(app).post('/api/projects/1/custom-fields')
      .send({ name: 'Total', fieldType: 'calculated', config: { formula: '{5} + {6}' } })
    expect(res.status).toBe(201)
    expect(res.body.formula).toBe('{5} + {6}')
    expect(res.body.readOnly).toBe(true)
  })

  it('rejects calculated without formula', async () => {
    const res = await request(app).post('/api/projects/1/custom-fields')
      .send({ name: 'Total', fieldType: 'calculated' })
    expect(res.status).toBe(400)
  })

  it('rejects an unknown field type', async () => {
    const res = await request(app).post('/api/projects/1/custom-fields')
      .send({ name: 'X', fieldType: 'rating' })
    expect(res.status).toBe(400)
  })
})

/* ============================== value validation ============================== */
describe('JL-113 — PUT value validation', () => {
  it('stores a valid multi_select array', async () => {
    get.mockResolvedValue({ id: 10, field_type: 'multi_select', options: JSON.stringify(['a', 'b']), config: null })
    run.mockResolvedValue({ lastID: 1 })
    const res = await request(app).put('/api/issues/1/custom-fields/10').send({ value: ['a'] })
    expect(res.status).toBe(200)
    expect(res.body.value).toEqual(['a'])
    // stored as JSON string
    expect(run).toHaveBeenCalledWith(expect.stringContaining('INSERT'), [1, 10, JSON.stringify(['a'])])
  })

  it('rejects a non-array multi_select value', async () => {
    get.mockResolvedValue({ id: 10, field_type: 'multi_select', options: JSON.stringify(['a', 'b']), config: null })
    const res = await request(app).put('/api/issues/1/custom-fields/10').send({ value: 'a' })
    expect(res.status).toBe(400)
  })

  it('rejects multi_select values outside the option set', async () => {
    get.mockResolvedValue({ id: 10, field_type: 'multi_select', options: JSON.stringify(['a', 'b']), config: null })
    const res = await request(app).put('/api/issues/1/custom-fields/10').send({ value: ['z'] })
    expect(res.status).toBe(400)
  })

  it('stores a valid user_picker email', async () => {
    get.mockResolvedValueOnce({ id: 12, field_type: 'user_picker', options: '[]', config: null })
    get.mockResolvedValueOnce({ id: 7 }) // member exists
    run.mockResolvedValue({ lastID: 1 })
    const res = await request(app).put('/api/issues/1/custom-fields/12').send({ value: 'dev@test.com' })
    expect(res.status).toBe(200)
    expect(res.body.value).toBe('dev@test.com')
  })

  it('rejects an unknown user_picker email with 400', async () => {
    get.mockResolvedValueOnce({ id: 12, field_type: 'user_picker', options: '[]', config: null })
    get.mockResolvedValueOnce(undefined) // no such member
    const res = await request(app).put('/api/issues/1/custom-fields/12').send({ value: 'ghost@test.com' })
    expect(res.status).toBe(400)
  })

  it('stores a valid cascading_select value', async () => {
    get.mockResolvedValue({ id: 13, field_type: 'cascading_select', options: '[]', config: JSON.stringify({ cascade: [{ parent: 'P1', children: ['C1'] }] }) })
    run.mockResolvedValue({ lastID: 1 })
    const res = await request(app).put('/api/issues/1/custom-fields/13').send({ value: { parent: 'P1', child: 'C1' } })
    expect(res.status).toBe(200)
    expect(res.body.value).toEqual({ parent: 'P1', child: 'C1' })
  })

  it('rejects a cascading_select value with an invalid parent', async () => {
    get.mockResolvedValue({ id: 13, field_type: 'cascading_select', options: '[]', config: JSON.stringify({ cascade: [{ parent: 'P1', children: ['C1'] }] }) })
    const res = await request(app).put('/api/issues/1/custom-fields/13').send({ value: { parent: 'NOPE', child: 'C1' } })
    expect(res.status).toBe(400)
  })

  it('rejects a cascading_select value with a child not under the parent', async () => {
    get.mockResolvedValue({ id: 13, field_type: 'cascading_select', options: '[]', config: JSON.stringify({ cascade: [{ parent: 'P1', children: ['C1'] }] }) })
    const res = await request(app).put('/api/issues/1/custom-fields/13').send({ value: { parent: 'P1', child: 'XX' } })
    expect(res.status).toBe(400)
  })

  it('rejects writing to a calculated field with 400', async () => {
    get.mockResolvedValue({ id: 14, field_type: 'calculated', options: '[]', config: JSON.stringify({ formula: '{5}+{6}' }) })
    const res = await request(app).put('/api/issues/1/custom-fields/14').send({ value: '99' })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric number value', async () => {
    get.mockResolvedValue({ id: 20, field_type: 'number', options: '[]', config: null })
    const res = await request(app).put('/api/issues/1/custom-fields/20').send({ value: 'abc' })
    expect(res.status).toBe(400)
  })

  it('keeps plain text working', async () => {
    get.mockResolvedValue({ id: 21, field_type: 'text', options: '[]', config: null })
    run.mockResolvedValue({ lastID: 1 })
    const res = await request(app).put('/api/issues/1/custom-fields/21').send({ value: 'hello' })
    expect(res.status).toBe(200)
    expect(res.body.value).toBe('hello')
  })
})

/* ============================== calculated compute ============================== */
describe('JL-113 — calculated field computes on read', () => {
  it('computes a formula from other numeric field values', async () => {
    get.mockResolvedValue({ project_id: 1 }) // issue lookup
    all.mockResolvedValue([
      { id: 5, project_id: 1, name: 'A', field_type: 'number', options: '[]', config: null, field_value: '10' },
      { id: 6, project_id: 1, name: 'B', field_type: 'number', options: '[]', config: null, field_value: '4' },
      { id: 14, project_id: 1, name: 'Total', field_type: 'calculated', options: '[]', config: JSON.stringify({ formula: '{5} * {6} + 2' }), field_value: null },
    ])
    const res = await request(app).get('/api/issues/1/custom-fields')
    expect(res.status).toBe(200)
    const calc = res.body.find((f) => f.id === 14)
    expect(calc.value).toBe(42)
    expect(calc.readOnly).toBe(true)
  })

  it('parses stored multi_select values back into an array on read', async () => {
    get.mockResolvedValue({ project_id: 1 })
    all.mockResolvedValue([
      { id: 10, project_id: 1, name: 'Tags', field_type: 'multi_select', options: JSON.stringify(['a', 'b']), config: null, field_value: JSON.stringify(['a', 'b']) },
    ])
    const res = await request(app).get('/api/issues/1/custom-fields')
    expect(res.status).toBe(200)
    expect(res.body[0].value).toEqual(['a', 'b'])
  })
})
