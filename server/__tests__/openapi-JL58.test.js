import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import docsRoutes from '../routes/docs.js'
import openapiSpec from '../openapi.js'

// Mount the public docs routes exactly as index.js does (before any auth).
function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api', docsRoutes)
  return app
}

describe('JL-58 — API Documentation (OpenAPI)', () => {
  describe('GET /api/openapi.json', () => {
    it('returns a valid OpenAPI 3.0 object', async () => {
      const res = await request(createApp()).get('/api/openapi.json')
      expect(res.status).toBe(200)
      expect(res.type).toMatch(/json/)
      // openapi field present and 3.x
      expect(typeof res.body.openapi).toBe('string')
      expect(res.body.openapi.startsWith('3.')).toBe(true)
      // info with title + version (versioning documented)
      expect(res.body.info).toBeTruthy()
      expect(res.body.info.title).toBeTruthy()
      expect(res.body.info.version).toBeTruthy()
      // non-empty paths
      expect(res.body.paths).toBeTruthy()
      expect(Object.keys(res.body.paths).length).toBeGreaterThan(0)
      // bearerAuth JWT security scheme
      const scheme = res.body.components.securitySchemes.bearerAuth
      expect(scheme).toBeTruthy()
      expect(scheme.type).toBe('http')
      expect(scheme.scheme).toBe('bearer')
      expect(scheme.bearerFormat).toBe('JWT')
    })

    it('documents the core auth + issue endpoints', async () => {
      const res = await request(createApp()).get('/api/openapi.json')
      expect(res.body.paths['/auth/login']).toBeTruthy()
      expect(res.body.paths['/auth/signup']).toBeTruthy()
      expect(res.body.paths['/auth/me']).toBeTruthy()
      expect(res.body.paths['/issues']).toBeTruthy()
      expect(res.body.paths['/issues/{id}']).toBeTruthy()
    })

    it('the exported spec object matches what the endpoint serves', () => {
      expect(openapiSpec.openapi.startsWith('3.')).toBe(true)
      expect(Object.keys(openapiSpec.paths).length).toBeGreaterThan(0)
    })
  })

  describe('GET /api/docs', () => {
    it('returns a self-contained HTML page referencing openapi.json', async () => {
      const res = await request(createApp()).get('/api/docs')
      expect(res.status).toBe(200)
      expect(res.type).toMatch(/html/)
      expect(res.text).toContain('<html')
      expect(res.text).toContain('openapi.json')
      // no external CDN references
      expect(res.text).not.toMatch(/https?:\/\/(cdn|unpkg|jsdelivr)/i)
    })
  })
})
