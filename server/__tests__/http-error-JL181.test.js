import { describe, it, expect, vi } from 'vitest'
import { sendError } from '../utils/httpError.js'

// Minimal Express `res` double that records the status and json body, mirroring
// the chainable `res.status(n).json(body)` contract routes rely on.
function makeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    status: vi.fn(function status(code) {
      res.statusCode = code
      return res
    }),
    json: vi.fn(function json(payload) {
      res.body = payload
      return res
    }),
  }
  return res
}

describe('sendError (JL-181)', () => {
  it('writes the canonical { error } shape with the given status', () => {
    const res = makeRes()
    sendError(res, 404, 'Issue not found')
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.body).toEqual({ error: 'Issue not found' })
  })

  it('is byte-identical to the inline res.status().json({ error }) form', () => {
    const res = makeRes()
    sendError(res, 400, 'Bad request')
    expect(JSON.stringify(res.body)).toBe(JSON.stringify({ error: 'Bad request' }))
  })

  it('merges extra fields after error (e.g. field validation errors)', () => {
    const res = makeRes()
    sendError(res, 400, 'Validation failed', { errors: ['title is required'] })
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Validation failed', errors: ['title is required'] })
    // Key order: error first, then spread extras.
    expect(Object.keys(res.body)).toEqual(['error', 'errors'])
  })

  it('ignores a non-object extra argument', () => {
    const res = makeRes()
    sendError(res, 500, 'Internal server error', null)
    expect(res.body).toEqual({ error: 'Internal server error' })
  })

  it('returns the res object so handlers can `return sendError(...)`', () => {
    const res = makeRes()
    const out = sendError(res, 403, 'Forbidden')
    expect(out).toBe(res)
  })
})
