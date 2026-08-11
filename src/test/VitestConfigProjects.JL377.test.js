// @vitest-environment node
//
// Importing vite.config.js pulls in esbuild, which refuses to load under jsdom
// ("new TextEncoder().encode('') instanceof Uint8Array is incorrectly false").
// This file asserts on build configuration, so node is the correct environment.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import viteConfig from '../../vite.config.js'

/* ================================================================
   JL-377 — test suite flakiness guard

   The suite used to set `environment: 'jsdom'` globally, so all ~163 backend
   suites instantiated a DOM they never used (66s of environment setup against
   4.8s of tests on a 12-file sample). That inflated wall clock past the 5000ms
   default timeout and starved the fork pool, producing nondeterministic
   "Test timed out in 5000ms" and "Failed to start forks worker" failures.

   Repeatability itself cannot be unit tested — it is verified by running the
   full suite repeatedly. What these tests DO guard is the configuration that
   made it repeatable, so the fix cannot be quietly undone.
   ================================================================ */

const config = typeof viteConfig === 'function' ? viteConfig({ command: 'serve', mode: 'test' }) : viteConfig

function projectByName(name) {
  return config.test.projects.find((p) => p.test?.name === name)
}

describe('JL-377 — Vitest project split', () => {
  it('does not set a global environment that would apply jsdom to backend suites', () => {
    // The root `test` block must not carry an `environment`; each project owns it.
    expect(config.test.environment).toBeUndefined()
  })

  it('defines exactly two projects: client and server', () => {
    expect(Array.isArray(config.test.projects)).toBe(true)
    const names = config.test.projects.map((p) => p.test?.name).sort()
    expect(names).toEqual(['client', 'server'])
  })

  it('runs the client project in jsdom with the DOM setup file', () => {
    const client = projectByName('client')
    expect(client.test.environment).toBe('jsdom')
    expect(client.test.setupFiles).toContain('./src/test/setup.js')
  })

  it('runs the server project in node, without the DOM setup file', () => {
    const server = projectByName('server')
    expect(server.test.environment).toBe('node')
    // This is the actual fix: backend suites must not pay for jsdom.
    expect(server.test.environment).not.toBe('jsdom')
    expect(server.test.setupFiles).toContain('./src/test/setup.env.js')
    expect(server.test.setupFiles ?? []).not.toContain('./src/test/setup.js')
  })

  it('keeps the server setup free of DOM-dependent imports', () => {
    // setup.env.js is loaded in a plain node environment, so importing
    // @testing-library/jest-dom there would be a latent breakage.
    const source = readFileSync(resolve(process.cwd(), 'src/test/setup.env.js'), 'utf8')
    expect(source).not.toMatch(/jest-dom/)
    expect(source).toMatch(/JWT_SECRET/)
  })

  it('covers every test directory between the two projects', () => {
    const includes = config.test.projects.flatMap((p) => p.test?.include ?? [])
    // 140 files live under src/, 163 under server/ — both roots must be claimed.
    expect(includes.some((g) => g.startsWith('src/'))).toBe(true)
    expect(includes.some((g) => g.startsWith('server/'))).toBe(true)
    // The client project must accept .jsx (132 of its 140 files) and .js (8).
    const clientInclude = projectByName('client').test.include.join(' ')
    expect(clientInclude).toMatch(/jsx/)
    expect(clientInclude).toMatch(/js/)
  })

  it('allows more than the 5000ms default per test', () => {
    // Scheduling delay under a loaded pool must not read as a test failure.
    expect(config.test.testTimeout).toBeGreaterThan(5000)
    expect(config.test.hookTimeout).toBeGreaterThan(5000)
  })

  it('caps the worker pool so a high-core machine does not oversubscribe', () => {
    // Vitest 4 removed `poolOptions` — the cap must be the top-level
    // `maxWorkers`, or it is silently ignored and the pool grows to core count.
    expect(config.test.poolOptions).toBeUndefined()
    expect(config.test.maxWorkers).toBeGreaterThan(0)
    // Must be a real cap, not simply the machine's core count.
    expect(config.test.maxWorkers).toBeLessThanOrEqual(16)
  })
})
