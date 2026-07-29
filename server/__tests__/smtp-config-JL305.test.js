// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/* ------------------------------------------------------------------ *
 * JL-305 — Centralized SMTP configuration in server/config.js
 *
 * Asserts that config.js exposes the SMTP settings (with correct types
 * and defaults) and that isMailConfigured() reflects the environment:
 * true only when SMTP_HOST + SMTP_USER + SMTP_PASS are all set.
 * No live SMTP server and no DB involved.
 * ------------------------------------------------------------------ */

const SMTP_ENV_VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']

function clearSmtpEnv() {
  for (const name of SMTP_ENV_VARS) vi.stubEnv(name, '')
}

// Fresh import so module-load-time SMTP_* constants pick up the stubbed env.
async function loadConfig() {
  vi.resetModules()
  return import('../config.js')
}

beforeEach(() => {
  clearSmtpEnv()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('config.js SMTP exports (JL-305)', () => {
  it('exposes safe defaults when no SMTP env vars are set', async () => {
    const config = await loadConfig()

    expect(config.SMTP_HOST).toBe('')
    expect(config.SMTP_PORT).toBe(587) // numeric default
    expect(typeof config.SMTP_PORT).toBe('number')
    expect(config.SMTP_USER).toBe('')
    expect(config.SMTP_PASS).toBe('')
    expect(config.SMTP_FROM).toBe('noreply@ecm-jira.local')
  })

  it('exposes the configured values (SMTP_PORT coerced to Number)', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp.test.com')
    vi.stubEnv('SMTP_PORT', '2525')
    vi.stubEnv('SMTP_USER', 'mailer@test.com')
    vi.stubEnv('SMTP_PASS', 'secret')
    vi.stubEnv('SMTP_FROM', 'noreply@test.com')
    const config = await loadConfig()

    expect(config.SMTP_HOST).toBe('smtp.test.com')
    expect(config.SMTP_PORT).toBe(2525)
    expect(typeof config.SMTP_PORT).toBe('number')
    expect(config.SMTP_USER).toBe('mailer@test.com')
    expect(config.SMTP_PASS).toBe('secret')
    expect(config.SMTP_FROM).toBe('noreply@test.com')
  })

  it('falls back SMTP_FROM to SMTP_USER when SMTP_FROM is unset', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp.test.com')
    vi.stubEnv('SMTP_USER', 'mailer@test.com')
    vi.stubEnv('SMTP_PASS', 'secret')
    const config = await loadConfig()

    expect(config.SMTP_FROM).toBe('mailer@test.com')
  })
})

describe('isMailConfigured() (JL-305)', () => {
  it('is false when nothing is configured', async () => {
    const { isMailConfigured } = await loadConfig()
    expect(isMailConfigured()).toBe(false)
  })

  it('is true when SMTP_HOST + SMTP_USER + SMTP_PASS are all set in the env', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp.test.com')
    vi.stubEnv('SMTP_USER', 'mailer@test.com')
    vi.stubEnv('SMTP_PASS', 'secret')
    const { isMailConfigured } = await loadConfig()
    expect(isMailConfigured()).toBe(true)
  })

  it('is false when only partially configured (host without credentials)', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp.test.com')
    const { isMailConfigured } = await loadConfig()
    expect(isMailConfigured()).toBe(false)
  })

  it('reads process.env at call time — toggling env flips the result without re-import', async () => {
    const { isMailConfigured } = await loadConfig()
    expect(isMailConfigured()).toBe(false)

    vi.stubEnv('SMTP_HOST', 'smtp.test.com')
    vi.stubEnv('SMTP_USER', 'mailer@test.com')
    vi.stubEnv('SMTP_PASS', 'secret')
    expect(isMailConfigured()).toBe(true)
  })

  it('is a pure predicate over an explicit env object', async () => {
    const { isMailConfigured } = await loadConfig()

    expect(
      isMailConfigured({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' }),
    ).toBe(true)
    expect(isMailConfigured({ SMTP_HOST: 'h', SMTP_USER: 'u' })).toBe(false)
    expect(isMailConfigured({ SMTP_USER: 'u', SMTP_PASS: 'p' })).toBe(false)
    expect(isMailConfigured({ SMTP_HOST: 'h', SMTP_PASS: 'p' })).toBe(false)
    // Whitespace-only values do not count as configured.
    expect(
      isMailConfigured({ SMTP_HOST: '  ', SMTP_USER: 'u', SMTP_PASS: 'p' }),
    ).toBe(false)
    expect(isMailConfigured({})).toBe(false)
  })
})

describe('mailer uses the centralized config (JL-305)', () => {
  it('mailer.isSmtpConfigured() agrees with config.isMailConfigured()', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp.test.com')
    vi.stubEnv('SMTP_USER', 'mailer@test.com')
    vi.stubEnv('SMTP_PASS', 'secret')
    vi.resetModules()
    const config = await import('../config.js')
    const mailer = await import('../utils/mailer.js')

    expect(config.isMailConfigured()).toBe(true)
    expect(mailer.isSmtpConfigured()).toBe(true)
  })

  it('both report unconfigured when credentials are absent', async () => {
    vi.resetModules()
    const config = await import('../config.js')
    const mailer = await import('../utils/mailer.js')

    expect(config.isMailConfigured()).toBe(false)
    expect(mailer.isSmtpConfigured()).toBe(false)
  })
})
