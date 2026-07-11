// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { validateConfig, assertValidConfig, DEFAULT_JWT_SECRET } from '../config.js'
import { scanText } from '../../scripts/scan-secrets.mjs'

// A strong production-grade secret used across the "happy path" cases.
const STRONG_SECRET = 'kQ7x9Zr2Vb84Lm3PnW6tYcH1sD0fG5jA8eR4uI2oK9lXpM7'

describe('JL-102 validateConfig — production secret enforcement', () => {
  it('returns a fatal error when JWT_SECRET is missing in production', () => {
    const res = validateConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' })
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => /JWT_SECRET/i.test(e))).toBe(true)
  })

  it('returns a fatal error when JWT_SECRET equals the known default placeholder in production', () => {
    const res = validateConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: DEFAULT_JWT_SECRET,
    })
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => /JWT_SECRET/i.test(e))).toBe(true)
  })

  it('flags other common placeholder secrets (case-insensitive) in production', () => {
    for (const weak of ['change-me', 'secret', 'CHANGEME', 'password']) {
      const res = validateConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://x',
        JWT_SECRET: weak,
      })
      expect(res.ok, `expected "${weak}" to be rejected`).toBe(false)
    }
  })

  it('flags a too-short (but non-placeholder) secret in production', () => {
    const res = validateConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: 'a1b2c3',
    })
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => /short/i.test(e))).toBe(true)
  })

  it('requires DATABASE_URL in production', () => {
    const res = validateConfig({ NODE_ENV: 'production', JWT_SECRET: STRONG_SECRET })
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => /DATABASE_URL/i.test(e))).toBe(true)
  })

  it('passes in production when all critical secrets are strong', () => {
    const res = validateConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@host:5432/db',
      JWT_SECRET: STRONG_SECRET,
    })
    expect(res.ok).toBe(true)
    expect(res.errors).toHaveLength(0)
  })
})

describe('JL-102 validateConfig — lenient in dev/test', () => {
  it('passes in development regardless of insecure secret', () => {
    const res = validateConfig({ NODE_ENV: 'development', JWT_SECRET: DEFAULT_JWT_SECRET })
    expect(res.ok).toBe(true)
    expect(res.errors).toHaveLength(0)
    // But still warns.
    expect(res.warnings.length).toBeGreaterThan(0)
  })

  it('passes in test env with no secrets set at all', () => {
    const res = validateConfig({ NODE_ENV: 'test' })
    expect(res.ok).toBe(true)
    expect(res.errors).toHaveLength(0)
  })

  it('passes when NODE_ENV is unset (treated as non-production)', () => {
    const res = validateConfig({ JWT_SECRET: 'anything' })
    expect(res.ok).toBe(true)
  })

  it('does NOT throw under the current process env (test runner safety)', () => {
    expect(() => assertValidConfig(process.env, { logger: { warn() {}, error() {} } })).not.toThrow()
  })
})

describe('JL-102 validateConfig — advisory warnings', () => {
  it('warns when SMTP is partially configured', () => {
    const res = validateConfig({
      NODE_ENV: 'development',
      JWT_SECRET: STRONG_SECRET,
      SMTP_HOST: 'smtp.example.com',
      // SMTP_USER / SMTP_PASS intentionally missing
    })
    expect(res.warnings.some((w) => /SMTP/i.test(w))).toBe(true)
  })

  it('warns when an OAuth provider has only one credential of its pair', () => {
    const res = validateConfig({
      NODE_ENV: 'development',
      JWT_SECRET: STRONG_SECRET,
      GOOGLE_CLIENT_ID: 'abc.apps.googleusercontent.com',
      // GOOGLE_CLIENT_SECRET missing
    })
    expect(res.warnings.some((w) => /GOOGLE OAuth/i.test(w))).toBe(true)
  })

  it('does not warn about OAuth when both credentials are set', () => {
    const res = validateConfig({
      NODE_ENV: 'development',
      JWT_SECRET: STRONG_SECRET,
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: 'sec',
    })
    expect(res.warnings.some((w) => /GITHUB OAuth/i.test(w))).toBe(false)
  })
})

describe('JL-102 assertValidConfig — throwing wrapper', () => {
  const silentLogger = { warn() {}, error() {} }

  it('throws when production config is fatally insecure', () => {
    expect(() =>
      assertValidConfig(
        { NODE_ENV: 'production', JWT_SECRET: DEFAULT_JWT_SECRET, DATABASE_URL: 'x' },
        { logger: silentLogger },
      ),
    ).toThrow(/configuration/i)
  })

  it('returns the result (no throw) when production config is valid', () => {
    const res = assertValidConfig(
      {
        NODE_ENV: 'production',
        JWT_SECRET: STRONG_SECRET,
        DATABASE_URL: 'postgresql://user:pass@host:5432/db',
      },
      { logger: silentLogger },
    )
    expect(res.ok).toBe(true)
  })
})

describe('JL-102 scan-secrets matcher', () => {
  it('detects an AWS access-key-like string', () => {
    const findings = scanText('const key = "AKIAIOSFODNN7EXAMPLE"')
    expect(findings.some((f) => f.ruleId === 'aws-access-key-id')).toBe(true)
  })

  it('detects a private key header', () => {
    const findings = scanText('-----BEGIN RSA PRIVATE KEY-----\nMIIEabc...')
    expect(findings.some((f) => f.ruleId === 'private-key')).toBe(true)
  })

  it('detects a high-entropy secret assignment', () => {
    const findings = scanText('const SECRET = "aB3xYz9Qw7Lm2Kp5Rn8Tv"')
    expect(findings.some((f) => f.ruleId === 'high-entropy-assignment')).toBe(true)
  })

  it('ignores ordinary code with no secrets', () => {
    const src = [
      'import express from "express"',
      'const app = express()',
      'app.get("/health", (req, res) => res.json({ status: "ok" }))',
      'export default app',
    ].join('\n')
    expect(scanText(src)).toHaveLength(0)
  })

  it('ignores obvious placeholder secret values', () => {
    expect(scanText('password = "changeme"')).toHaveLength(0)
    expect(scanText('const API_KEY = "your-api-key-here"')).toHaveLength(0)
  })

  it('reports line numbers for findings', () => {
    const findings = scanText('line one\nline two\nkey = "AKIAIOSFODNN7EXAMPLE"')
    expect(findings[0].line).toBe(3)
  })
})
