import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

// --- Mock the db layer so no live PostgreSQL is needed ---
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, get } from '../db.js'
import { JWT_SECRET } from '../config.js'
import { hashPassword, verifyPassword } from '../middleware/validate.js'
import { errorHandler } from '../middleware/errorHandler.js'
import authRoutes from '../routes/auth.js'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  app.use(errorHandler)
  return app
}

function authToken(id = 1, email = 'user@gmail.com') {
  return jwt.sign({ sub: id, email }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/auth/change-password (JL-198)', () => {
  it('changes the password when the current password is correct', async () => {
    const currentHash = hashPassword('oldpass1')
    // 1st get: user row. 2nd get: security policy (null → permissive defaults).
    get.mockResolvedValueOnce({ id: 1, password_hash: currentHash })
    get.mockResolvedValueOnce(null)
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const app = makeApp()
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ currentPassword: 'oldpass1', newPassword: 'brandnew2' })

    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/changed/i)

    // The UPDATE was issued with a fresh hash that verifies against the new password.
    expect(run).toHaveBeenCalledTimes(1)
    const [sql, params] = run.mock.calls[0]
    expect(sql).toMatch(/UPDATE users SET password_hash/i)
    const newStoredHash = params[0]
    expect(verifyPassword('brandnew2', newStoredHash)).toBe(true)
    expect(verifyPassword('oldpass1', newStoredHash)).toBe(false)
  })

  it('rejects a wrong current password with 401 and no update', async () => {
    const currentHash = hashPassword('oldpass1')
    get.mockResolvedValueOnce({ id: 1, password_hash: currentHash })

    const app = makeApp()
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ currentPassword: 'wrongpass', newPassword: 'brandnew2' })

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/incorrect/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a too-short new password with 400', async () => {
    const currentHash = hashPassword('oldpass1')
    get.mockResolvedValueOnce({ id: 1, password_hash: currentHash })

    const app = makeApp()
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ currentPassword: 'oldpass1', newPassword: 'ab' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/at least 6/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a new password equal to the current password with 400', async () => {
    const currentHash = hashPassword('samepass1')
    get.mockResolvedValueOnce({ id: 1, password_hash: currentHash })

    const app = makeApp()
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ currentPassword: 'samepass1', newPassword: 'samepass1' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/different/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request with 401', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'oldpass1', newPassword: 'brandnew2' })

    expect(res.status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })
})
