import { describe, it, expect, beforeAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import { initializeDatabase } from '../db.js'
import authRoutes from '../routes/auth.js'
import { errorHandler } from '../middleware/errorHandler.js'

let app

beforeAll(async () => {
  process.env.DB_PATH = ':memory:'
  await initializeDatabase()
  app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  app.use(errorHandler)
})

const testEmail = `authtest_${Date.now()}@gmail.com`

describe('POST /api/auth/signup', () => {
  it('creates a new user and returns a token', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: testEmail, password: 'password123' })

    expect(res.status).toBe(201)
    expect(res.body.user).toBeDefined()
    expect(res.body.user.email).toBe(testEmail)
    expect(res.body.token).toBeDefined()
    expect(typeof res.body.token).toBe('string')
  })

  it('rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: testEmail, password: 'password123' })

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('already registered')
  })

  it('rejects short password', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'short@gmail.com', password: '123' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('6 characters')
  })

  it('rejects invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'notvalid', password: 'password123' })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/login', () => {
  it('authenticates valid credentials and returns a token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: 'password123' })

    expect(res.status).toBe(200)
    expect(res.body.user).toBeDefined()
    expect(res.body.user.email).toBe(testEmail)
    expect(res.body.token).toBeDefined()
  })

  it('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: 'wrongpass' })

    expect(res.status).toBe(401)
    expect(res.body.error).toContain('Invalid')
  })

  it('rejects non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@gmail.com', password: 'password123' })

    expect(res.status).toBe(401)
  })
})
