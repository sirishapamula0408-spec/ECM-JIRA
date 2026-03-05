import { describe, it, expect } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { JWT_SECRET } from '../config.js'
import { authGuard } from '../middleware/authGuard.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.get('/protected', authGuard, (_req, res) => {
    res.json({ user: req.user, ok: true })
  })
  // Fix: use req from handler params
  app.get('/whoami', authGuard, (req, res) => {
    res.json({ userId: req.user.id, email: req.user.email })
  })
  return app
}

describe('authGuard middleware', () => {
  it('rejects requests without Authorization header', async () => {
    const app = createApp()
    const res = await request(app).get('/whoami')
    expect(res.status).toBe(401)
    expect(res.body.error).toContain('Authentication required')
  })

  it('rejects malformed Authorization header', async () => {
    const app = createApp()
    const res = await request(app)
      .get('/whoami')
      .set('Authorization', 'BadScheme xyz')
    expect(res.status).toBe(401)
  })

  it('rejects expired token', async () => {
    const app = createApp()
    const token = jwt.sign({ sub: 1, email: 'a@b.com' }, JWT_SECRET, { expiresIn: '-1s' })
    const res = await request(app)
      .get('/whoami')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toContain('Invalid or expired')
  })

  it('allows valid token and sets req.user', async () => {
    const app = createApp()
    const token = jwt.sign({ sub: 42, email: 'user@test.com' }, JWT_SECRET, { expiresIn: '1h' })
    const res = await request(app)
      .get('/whoami')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.userId).toBe(42)
    expect(res.body.email).toBe('user@test.com')
  })
})
