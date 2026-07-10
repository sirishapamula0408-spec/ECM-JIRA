import { describe, it, expect, vi } from 'vitest'
import {
  shouldServeStatic,
  setupStaticServing,
  SPA_FALLBACK_PATTERN,
} from '../serveStatic.js'

// A minimal fake Express app that records every middleware/route registration
// so we can assert on the wiring without spinning up a real HTTP server.
function makeFakeApp() {
  const uses = []
  const gets = []
  return {
    uses,
    gets,
    use: (...args) => uses.push(args),
    get: (path, handler) => gets.push({ path, handler }),
  }
}

describe('shouldServeStatic', () => {
  it('is enabled in production', () => {
    expect(shouldServeStatic({ NODE_ENV: 'production' })).toBe(true)
  })

  it('is enabled via the SERVE_STATIC flag', () => {
    expect(shouldServeStatic({ SERVE_STATIC: 'true' })).toBe(true)
    expect(shouldServeStatic({ SERVE_STATIC: '1' })).toBe(true)
  })

  it('is disabled by default (dev)', () => {
    expect(shouldServeStatic({})).toBe(false)
    expect(shouldServeStatic({ NODE_ENV: 'development' })).toBe(false)
    expect(shouldServeStatic({ SERVE_STATIC: 'false' })).toBe(false)
  })
})

describe('setupStaticServing', () => {
  it('registers the static middleware and an SPA fallback route', () => {
    const app = makeFakeApp()
    const sentinelStatic = vi.fn()

    const result = setupStaticServing(app, {
      distDir: '/some/dist',
      staticMiddleware: sentinelStatic,
    })

    // Static middleware registered via app.use with the injected sentinel.
    expect(app.uses).toHaveLength(1)
    expect(app.uses[0][0]).toBe(sentinelStatic)

    // Exactly one SPA fallback GET route registered, using a RegExp path.
    expect(app.gets).toHaveLength(1)
    expect(app.gets[0].path).toBeInstanceOf(RegExp)
    expect(app.gets[0].path).toBe(SPA_FALLBACK_PATTERN)

    // Reports the resolved index file.
    expect(result.indexFile.replace(/\\/g, '/')).toBe('/some/dist/index.html')
  })

  it('SPA fallback does NOT swallow /api routes', () => {
    const pattern = SPA_FALLBACK_PATTERN
    // API paths must be excluded so REST/health/docs endpoints keep working.
    expect(pattern.test('/api')).toBe(false)
    expect(pattern.test('/api/')).toBe(false)
    expect(pattern.test('/api/issues')).toBe(false)
    expect(pattern.test('/api/health')).toBe(false)
    expect(pattern.test('/api/public/foo')).toBe(false)
  })

  it('SPA fallback DOES match client-side routes', () => {
    const pattern = SPA_FALLBACK_PATTERN
    expect(pattern.test('/')).toBe(true)
    expect(pattern.test('/board')).toBe(true)
    expect(pattern.test('/projects/42/automation')).toBe(true)
    // A path that merely starts with "api" (not the /api segment) still matches.
    expect(pattern.test('/apiary')).toBe(true)
  })

  it('SPA fallback handler serves index.html', () => {
    const app = makeFakeApp()
    setupStaticServing(app, {
      distDir: '/some/dist',
      staticMiddleware: vi.fn(),
    })
    const handler = app.gets[0].handler
    const res = { sendFile: vi.fn() }
    handler({ path: '/board' }, res)
    expect(res.sendFile).toHaveBeenCalledTimes(1)
    expect(res.sendFile.mock.calls[0][0].replace(/\\/g, '/')).toBe(
      '/some/dist/index.html',
    )
  })
})
