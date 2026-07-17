export const PORT = Number(process.env.PORT) || 4000
export const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://jira_lite:jira_lite_dev@localhost:5432/jira_lite'
// JL-90: no in-code fallback for the JWT signing secret. If JWT_SECRET is not
// set, tokens cannot be signed/verified — startup validation (assertRequiredEnv)
// makes the server fail fast instead of silently using a known secret.
export const JWT_SECRET = process.env.JWT_SECRET
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'
export const APP_URL = process.env.APP_URL || 'http://localhost:5173'
// JL-132: audit-log retention window (days). Entries older than this may be
// purged via POST /api/audit-log/retention. Default 365 days.
export const AUDIT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS) || 365

// --- JL-90: fail-fast environment validation ---
// Variables the server cannot safely run without.
export const REQUIRED_ENV_VARS = ['JWT_SECRET', 'DATABASE_URL']

/**
 * Returns the list of required environment variables that are missing or
 * blank in the given env (defaults to process.env). Pure — never exits the
 * process, so it is unit-testable; the caller (server/index.js) decides
 * whether to exit.
 */
export function assertRequiredEnv(env = process.env) {
  return REQUIRED_ENV_VARS.filter((name) => {
    const value = env[name]
    return value === undefined || value === null || String(value).trim() === ''
  })
}

// --- JL-98: Observability / structured logging ---
// LOG_LEVEL gates the structured logger (debug < info < warn < error). Messages
// below the threshold are suppressed. Under the test runner we default to a high
// threshold ('error') so suites stay quiet unless a test sets LOG_LEVEL explicitly.
const IS_TEST = process.env.NODE_ENV === 'test' || process.env.VITEST
export const LOG_LEVEL = (process.env.LOG_LEVEL || (IS_TEST ? 'error' : 'info')).toLowerCase()

// --- JL-81: OAuth / SSO providers (config-gated) ---
// A provider is considered "configured" only when both its client id and secret
// are present in the environment. Without config, OAuth endpoints respond 501.
// Authorize/token/userinfo URLs are known per provider; only credentials vary.
export const OAUTH_PROVIDERS = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
  },
}

// Where providers redirect back to after user consent.
export const OAUTH_REDIRECT_BASE = process.env.OAUTH_REDIRECT_BASE || `http://localhost:${PORT}`

export function getOAuthProvider(name) {
  return OAUTH_PROVIDERS[String(name || '').toLowerCase()] || null
}

export function isOAuthConfigured(name) {
  const p = getOAuthProvider(name)
  return Boolean(p && p.clientId && p.clientSecret)
}

// --- JL-93: Auth abuse protection (rate limiting, login lockout, strict CORS) ---
// Comma-separated allow-list of browser origins. EMPTY/unset → permissive CORS
// (reflect any origin) so local dev and existing tests keep working. Set it in
// production to lock cross-origin access down to known frontends.
export const CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS || ''

// --- JL-133: IP allowlisting ---
// Comma-separated allow-list of client IPs / CIDR ranges permitted to reach the
// API (e.g. "10.0.0.0/8, 203.0.113.5"). EMPTY/unset → allow ALL, so local dev
// and existing tests are entirely unaffected. Set it in production to restrict
// API access to an org's known network ranges.
export const IP_ALLOWLIST = process.env.IP_ALLOWLIST || ''
// JL-147: shared secret gating the Git provider webhook (/api/git/webhook).
// When unset the endpoint is open (dev convenience); when set, requests must
// present a matching shared token or a valid HMAC-SHA256 signature.
// Read via process.env at request time so it can be toggled per-test.
export const GIT_WEBHOOK_SECRET = process.env.GIT_WEBHOOK_SECRET || ''

// General API rate limiter (applied early, all /api traffic). Generous defaults
// so normal usage — and multi-request test suites — never trip it.
export const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000
export const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 600

// Tighter limiter scoped to /api/auth to blunt credential-stuffing.
export const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX) || 60

// Login brute-force lockout: N failures within the window → cooldown lock.
export const LOGIN_LOCKOUT_MAX_ATTEMPTS = Number(process.env.LOGIN_LOCKOUT_MAX_ATTEMPTS) || 5
export const LOGIN_LOCKOUT_WINDOW_MS = Number(process.env.LOGIN_LOCKOUT_WINDOW_MS) || 15 * 60 * 1000
export const LOGIN_LOCKOUT_MS = Number(process.env.LOGIN_LOCKOUT_MS) || 15 * 60 * 1000

// --- JL-95: Demo/seed data gating ---
// Demo/seed data must NEVER load unless this flag is explicitly "true".
// This keeps production (and CI/tests) from auto-seeding fictional data.
export const SEED_DEMO_DATA = process.env.SEED_DEMO_DATA === 'true'

// Runtime check (reads process.env each call) so seeding can be toggled without
// re-importing this module — used by seedDemoData() and initializeDatabase().
export function isSeedDemoDataEnabled() {
  return process.env.SEED_DEMO_DATA === 'true'
}

/* ============================================================
   JL-129: Live SSO — OIDC & SAML 2.0 (config-gated)
   ------------------------------------------------------------
   Real login flows activate only when a full set of env vars is present.
   Without config the SSO endpoints respond 501 (like the JL-81 OAuth scaffold),
   so dev/test behaviour is unchanged and no live IdP is ever contacted.
   ============================================================ */

// --- OIDC (openid-client v6) ---
export const OIDC_ISSUER_URL = process.env.OIDC_ISSUER_URL || ''
export const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID || ''
export const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || ''
export const OIDC_REDIRECT_URI =
  process.env.OIDC_REDIRECT_URI || `http://localhost:${PORT}/api/auth/sso/oidc/callback`

export function getOidcConfig() {
  return {
    issuerUrl: OIDC_ISSUER_URL,
    clientId: OIDC_CLIENT_ID,
    clientSecret: OIDC_CLIENT_SECRET,
    redirectUri: OIDC_REDIRECT_URI,
  }
}

// Pure predicate: OIDC is usable only when issuer + client id/secret + redirect are all set.
export function isOidcConfigured(cfg = getOidcConfig()) {
  return Boolean(cfg && cfg.issuerUrl && cfg.clientId && cfg.clientSecret && cfg.redirectUri)
}

// --- SAML 2.0 (@node-saml/node-saml v5) ---
export const SAML_ENTRY_POINT = process.env.SAML_ENTRY_POINT || ''
export const SAML_ISSUER = process.env.SAML_ISSUER || ''
export const SAML_CERT = process.env.SAML_CERT || ''
export const SAML_CALLBACK_URL =
  process.env.SAML_CALLBACK_URL || `http://localhost:${PORT}/api/auth/sso/saml/callback`

export function getSamlConfig() {
  return {
    entryPoint: SAML_ENTRY_POINT,
    issuer: SAML_ISSUER,
    cert: SAML_CERT,
    callbackUrl: SAML_CALLBACK_URL,
  }
}

// Pure predicate: SAML is usable only when entry point + issuer + IdP cert + callback are all set.
export function isSamlConfigured(cfg = getSamlConfig()) {
  return Boolean(cfg && cfg.entryPoint && cfg.issuer && cfg.cert && cfg.callbackUrl)
}

// --- SCIM 2.0 provisioning (JL-130, hardened JL-184) ---
// Shared bearer token that an enterprise IdP (Okta/Azure AD) presents on every
// /scim/v2 request. NO in-code default (JL-184): a repo-visible default token
// would leave the provisioning/deprovisioning API live behind a known
// credential. When unset, SCIM is treated as NOT configured and every
// /scim/v2 request is rejected with 501 (mirrors the JL-81/JL-129 config-gated
// pattern). Read via `getScimToken()` at request time so it can be toggled
// per-test without re-importing this module.
export const SCIM_TOKEN = process.env.SCIM_TOKEN || ''

export function getScimToken() {
  return process.env.SCIM_TOKEN || ''
}

export function isScimConfigured() {
  return Boolean(getScimToken())
}

// --- JL-137: Cloud attachment storage (S3-compatible, config-gated) ---
// When all required S3 vars are present, attachments are stored in object
// storage; otherwise the default local-disk backend (server/uploads) is used.
// S3_ENDPOINT is optional (for MinIO / non-AWS S3-compatible providers).
export const S3_BUCKET = process.env.S3_BUCKET || ''
export const S3_REGION = process.env.S3_REGION || ''
export const S3_ENDPOINT = process.env.S3_ENDPOINT || ''
export const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || ''
export const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || ''

export function getStorageConfig() {
  return {
    bucket: S3_BUCKET,
    region: S3_REGION,
    endpoint: S3_ENDPOINT,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  }
}

// --- JL-148: Inbound email → issue creation ---
// Shared secret a mail provider (SendGrid/Mailgun inbound-parse style) must
// present on the inbound webhook. When set, POST /api/inbound-email requires a
// matching token (header `x-inbound-token` or body `token`). When unset/blank,
// the endpoint is open (dev convenience) so local testing works out of the box.
export const INBOUND_EMAIL_TOKEN = process.env.INBOUND_EMAIL_TOKEN || ''

// --- SMTP / transactional email (JL-83) ---
export const SMTP_HOST = process.env.SMTP_HOST || ''
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 587
export const SMTP_USER = process.env.SMTP_USER || ''
export const SMTP_PASS = process.env.SMTP_PASS || ''
export const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'noreply@ecm-jira.local'

// --- JL-102: Secrets management / startup config validation ---
//
// Known dev/default placeholder values that must NEVER be used as a real secret
// in production. `validateConfig()` treats a JWT_SECRET matching any of these
// (case-insensitive) as a fatal error when NODE_ENV=production.
export const DEFAULT_JWT_SECRET = 'ecm-jira-dev-secret-change-in-production'

const INSECURE_SECRET_VALUES = new Set(
  [
    DEFAULT_JWT_SECRET,
    'change-in-production',
    'change-me-in-production',
    'changeme',
    'change-me',
    'secret',
    'jwt-secret',
    'your-secret',
    'your-secret-key',
    'dev-secret',
    'test-secret',
    'password',
    'placeholder',
  ].map((v) => v.toLowerCase()),
)

// Minimum acceptable length for a production secret. Short secrets are trivially
// brute-forceable regardless of whether they match a known placeholder.
const MIN_SECRET_LENGTH = 16

function isInsecureSecret(value) {
  if (!value || typeof value !== 'string') return true
  const trimmed = value.trim()
  if (trimmed.length === 0) return true
  if (INSECURE_SECRET_VALUES.has(trimmed.toLowerCase())) return true
  return false
}

/**
 * Validate critical configuration / secrets at startup.
 *
 * Pure and unit-testable: pass an explicit env object (defaults to
 * `process.env`). It never reads global state beyond the argument.
 *
 * Behaviour:
 *  - In production (`NODE_ENV=production`): missing/insecure critical secrets
 *    (notably JWT_SECRET) produce fatal errors. DATABASE_URL must be set.
 *  - In development/test (or unset NODE_ENV): lenient — no fatal errors, only
 *    advisory warnings, so tests and local dev never crash.
 *  - Partially-configured SMTP or OAuth providers produce warnings in every env.
 *
 * @param {Record<string,string|undefined>} [env=process.env]
 * @returns {{ ok: boolean, errors: string[], warnings: string[], isProduction: boolean }}
 */
export function validateConfig(env = process.env) {
  const errors = []
  const warnings = []
  const isProduction = String(env.NODE_ENV || '').toLowerCase() === 'production'

  // --- JWT_SECRET (the most critical secret) ---
  const jwtSecret = env.JWT_SECRET
  if (isProduction) {
    if (!jwtSecret || String(jwtSecret).trim().length === 0) {
      errors.push('JWT_SECRET is required in production but is not set.')
    } else if (isInsecureSecret(jwtSecret)) {
      errors.push(
        'JWT_SECRET is set to a known default/placeholder value; set a strong, unique secret in production.',
      )
    } else if (String(jwtSecret).length < MIN_SECRET_LENGTH) {
      errors.push(
        `JWT_SECRET is too short (min ${MIN_SECRET_LENGTH} characters recommended for production).`,
      )
    }

    // --- DATABASE_URL ---
    if (!env.DATABASE_URL || String(env.DATABASE_URL).trim().length === 0) {
      errors.push('DATABASE_URL is required in production but is not set.')
    }
  } else {
    // Dev/test: advise but never fail.
    if (!jwtSecret || isInsecureSecret(jwtSecret)) {
      warnings.push(
        'JWT_SECRET is using an insecure/default value — acceptable for dev/test, but must be changed before deploying to production.',
      )
    }
  }

  // --- SMTP: warn if partially configured (host without user/pass, etc.) ---
  const smtpParts = [env.SMTP_HOST, env.SMTP_USER, env.SMTP_PASS]
  const smtpSet = smtpParts.filter((v) => v && String(v).trim().length > 0).length
  if (smtpSet > 0 && smtpSet < smtpParts.length) {
    warnings.push(
      'SMTP is only partially configured (need SMTP_HOST, SMTP_USER and SMTP_PASS together); email delivery may fail.',
    )
  }

  // --- OAuth providers: warn if one credential of a pair is set without the other ---
  for (const provider of ['GOOGLE', 'GITHUB']) {
    const id = env[`${provider}_CLIENT_ID`]
    const secret = env[`${provider}_CLIENT_SECRET`]
    const hasId = id && String(id).trim().length > 0
    const hasSecret = secret && String(secret).trim().length > 0
    if (hasId !== hasSecret) {
      warnings.push(
        `${provider} OAuth is partially configured (need both ${provider}_CLIENT_ID and ${provider}_CLIENT_SECRET); provider will stay disabled.`,
      )
    }
  }

  return { ok: errors.length === 0, errors, warnings, isProduction }
}

/**
 * Run validateConfig and throw when there are fatal errors. Intended for
 * startup. Logs warnings to the console. Safe to call in any environment.
 *
 * @param {Record<string,string|undefined>} [env=process.env]
 * @param {{ logger?: Pick<Console,'warn'|'error'> }} [opts]
 * @returns {{ ok: boolean, errors: string[], warnings: string[], isProduction: boolean }}
 */
export function assertValidConfig(env = process.env, { logger = console } = {}) {
  const result = validateConfig(env)
  for (const w of result.warnings) {
    logger.warn(`[config] warning: ${w}`)
  }
  if (!result.ok) {
    for (const e of result.errors) {
      logger.error(`[config] FATAL: ${e}`)
    }
    throw new Error(
      `Insecure or incomplete configuration detected (${result.errors.length} fatal error(s)). ` +
        'Refusing to start. See logs above.',
    )
  }
  return result
}
