export const PORT = Number(process.env.PORT) || 4000
export const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://jira_lite:jira_lite_dev@localhost:5432/jira_lite'
export const JWT_SECRET = process.env.JWT_SECRET || 'ecm-jira-dev-secret-change-in-production'
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'
export const APP_URL = process.env.APP_URL || 'http://localhost:5173'

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

// --- JL-95: Demo/seed data gating ---
// Demo/seed data must NEVER load unless this flag is explicitly "true".
// This keeps production (and CI/tests) from auto-seeding fictional data.
export const SEED_DEMO_DATA = process.env.SEED_DEMO_DATA === 'true'

// Runtime check (reads process.env each call) so seeding can be toggled without
// re-importing this module — used by seedDemoData() and initializeDatabase().
export function isSeedDemoDataEnabled() {
  return process.env.SEED_DEMO_DATA === 'true'
}

// --- SMTP / transactional email (JL-83) ---
export const SMTP_HOST = process.env.SMTP_HOST || ''
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 587
export const SMTP_USER = process.env.SMTP_USER || ''
export const SMTP_PASS = process.env.SMTP_PASS || ''
export const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'noreply@ecm-jira.local'
