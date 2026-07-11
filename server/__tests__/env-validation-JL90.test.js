// JL-90 — Remove JWT secret fallback & fail-fast env validation
import { describe, it, expect, vi, afterEach } from 'vitest'
import { assertRequiredEnv, REQUIRED_ENV_VARS, JWT_SECRET } from '../config.js'

const LEGACY_DEFAULT_SECRET = 'ecm-jira-dev-secret-change-in-production'

describe('JL-90 assertRequiredEnv', () => {
  it('declares JWT_SECRET and DATABASE_URL as required', () => {
    expect(REQUIRED_ENV_VARS).toContain('JWT_SECRET')
    expect(REQUIRED_ENV_VARS).toContain('DATABASE_URL')
  })

  it('reports JWT_SECRET as missing when unset', () => {
    const missing = assertRequiredEnv({ DATABASE_URL: 'postgresql://x/y' })
    expect(missing).toEqual(['JWT_SECRET'])
  })

  it('treats blank/whitespace JWT_SECRET as missing', () => {
    expect(assertRequiredEnv({ JWT_SECRET: '', DATABASE_URL: 'postgresql://x/y' })).toContain('JWT_SECRET')
    expect(assertRequiredEnv({ JWT_SECRET: '   ', DATABASE_URL: 'postgresql://x/y' })).toContain('JWT_SECRET')
  })

  it('reports all missing required vars', () => {
    expect(assertRequiredEnv({})).toEqual(['JWT_SECRET', 'DATABASE_URL'])
  })

  it('returns an empty list when all required vars are present', () => {
    const missing = assertRequiredEnv({
      JWT_SECRET: 'a-strong-random-secret',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    })
    expect(missing).toEqual([])
  })

  it('does not exit the process — caller decides', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    expect(() => assertRequiredEnv({})).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })
})

describe('JL-90 no default JWT secret', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('config JWT_SECRET comes from the environment, not a hardcoded default', () => {
    // Test setup provides process.env.JWT_SECRET; config must mirror it exactly.
    expect(JWT_SECRET).toBe(process.env.JWT_SECRET)
    expect(JWT_SECRET).not.toBe(LEGACY_DEFAULT_SECRET)
  })

  it('JWT_SECRET is undefined (no fallback) when the env var is unset', async () => {
    const original = process.env.JWT_SECRET
    delete process.env.JWT_SECRET
    try {
      vi.resetModules()
      const freshConfig = await import('../config.js')
      expect(freshConfig.JWT_SECRET).toBeUndefined()
      expect(freshConfig.assertRequiredEnv()).toContain('JWT_SECRET')
    } finally {
      if (original !== undefined) process.env.JWT_SECRET = original
    }
  })
})
