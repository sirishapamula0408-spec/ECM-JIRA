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

// --- SMTP / transactional email (JL-83) ---
export const SMTP_HOST = process.env.SMTP_HOST || ''
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 587
export const SMTP_USER = process.env.SMTP_USER || ''
export const SMTP_PASS = process.env.SMTP_PASS || ''
export const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'noreply@ecm-jira.local'
