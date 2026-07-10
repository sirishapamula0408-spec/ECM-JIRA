import crypto from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { get, run, all } from '../db.js'
import {
  JWT_SECRET,
  APP_URL,
  getOAuthProvider,
  isOAuthConfigured,
  OAUTH_REDIRECT_BASE,
  getOidcConfig,
  isOidcConfigured,
  getSamlConfig,
  isSamlConfigured,
} from '../config.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { isAllowedEmail, hashPassword, verifyPassword } from '../middleware/validate.js'
import { authGuard } from '../middleware/authGuard.js'
import { loadUserRoles } from '../middleware/authorize.js'
import { sendMail, buildPasswordResetEmail, isSmtpConfigured } from '../utils/mailer.js'
import { generateSecret, getOtpAuthUrl, verifyTOTP } from '../services/totp.js'
import { loginLockout } from '../middleware/loginLockout.js'
import { upsertSsoUser } from '../services/sso.js'
import { safeAppendAudit } from '../services/auditLog.js'

// Build a lockout key from the submitted identity + client IP so that a single
// abusive source can't be masked by rotating emails, and vice versa.
function lockoutKey(email, req) {
  const ip = req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
  return `${email}|${ip}`
}

function issueToken(user, expiresIn = '1d') {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn })
}

const router = Router()

router.post('/signup', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')

  if (!isAllowedEmail(email)) {
    res.status(400).json({ error: 'Use a valid office email or Gmail address' })
    return
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' })
    return
  }

  const existing = await get('SELECT id FROM users WHERE email = ?', [email])
  if (existing) {
    res.status(409).json({ error: 'Email already registered. Please log in.' })
    return
  }

  const passwordHash = hashPassword(password)
  const created = await run('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, passwordHash])
  const user = await get('SELECT id, email, created_at FROM users WHERE id = ?', [created.lastID])

  // JL-74: Self-serve onboarding. Ensure the new user exists as a member so they
  // aren't stranded with memberId=null. The very first user to ever sign up becomes
  // the workspace Owner (Admin role, is_owner=TRUE); everyone else lands as Viewer.
  // Idempotent: only insert if no member row already exists for this email.
  try {
    const existingMember = await get('SELECT id FROM members WHERE LOWER(email) = LOWER(?)', [email])
    if (!existingMember) {
      const memberCount = await get('SELECT COUNT(*) AS count FROM members')
      const isFirst = Number(memberCount?.count || 0) === 0

      // Honor a pending invitation for this email, if one exists and is still valid.
      const invite = await get(
        `SELECT id, role FROM invitations
         WHERE LOWER(email) = LOWER(?) AND status = 'pending' AND expires_at > NOW()
         ORDER BY id DESC LIMIT 1`,
        [email],
      )

      const role = isFirst ? 'Admin' : invite ? invite.role : 'Viewer'
      const isOwner = isFirst
      const name = email.split('@')[0]

      await run(
        'INSERT INTO members (name, email, role, status, task_count, invited_by, is_owner) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, email, role, 'Active', 0, isFirst ? null : 'Self-signup', isOwner],
      )

      if (invite) {
        await run("UPDATE invitations SET status = 'accepted' WHERE id = ?", [invite.id])
      }
    }
  } catch (err) {
    // Onboarding member creation is best-effort — never block signup on it.
    console.error(`[auth] Failed to provision member for ${email}: ${err.message}`)
  }

  // JL-73: workspace bootstrap. The FIRST user to sign up becomes Owner of the
  // seeded 'default' workspace; subsequent users are added as Members. Best-effort
  // and fully non-breaking — any failure here never blocks signup.
  try {
    const totalUsers = await get('SELECT COUNT(*) AS count FROM users')
    const isFirstUser = Number(totalUsers?.count || 0) <= 1
    const defaultWorkspace = await get("SELECT id, owner_email FROM workspaces WHERE slug = 'default'")
    if (defaultWorkspace) {
      if (isFirstUser && !defaultWorkspace.owner_email) {
        await run('UPDATE workspaces SET owner_email = ? WHERE id = ?', [email, defaultWorkspace.id])
      }
      await run(
        `INSERT INTO workspace_members (workspace_id, member_email, role)
         VALUES (?, ?, ?)
         ON CONFLICT (workspace_id, member_email) DO NOTHING`,
        [defaultWorkspace.id, email, isFirstUser ? 'Owner' : 'Member'],
      )
    }
  } catch (err) {
    console.error(`[auth] workspace bootstrap skipped: ${err.message}`)
  }

  const token = issueToken(user, '7d')
  res.status(201).json({ user, token })
}))

router.post('/login', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const remember = Boolean(req.body?.remember)

  if (!isAllowedEmail(email)) {
    res.status(400).json({ error: 'Use a valid office email or Gmail address' })
    return
  }
  if (!password) {
    res.status(400).json({ error: 'Password is required' })
    return
  }

  // --- JL-93: brute-force lockout gate ---
  // If this identity+IP has too many recent failures, reject before touching the
  // DB or verifying credentials.
  const lockKey = lockoutKey(email, req)
  if (loginLockout.isLocked(lockKey)) {
    const retryAfter = loginLockout.retryAfter(lockKey)
    res.setHeader('Retry-After', String(retryAfter))
    res.status(429).json({
      error: 'Too many failed login attempts. Please try again later.',
      retryAfter,
    })
    return
  }

  const user = await get(
    'SELECT id, email, password_hash, created_at, mfa_enabled, mfa_secret FROM users WHERE email = ?',
    [email],
  )
  if (!user || !verifyPassword(password, user.password_hash)) {
    loginLockout.recordFailure(lockKey)
    res.status(401).json({ error: 'Invalid email or password' })
    return
  }

  // --- JL-81: MFA gate ---
  // If the user enabled TOTP MFA, a valid `mfaCode` must accompany the password
  // BEFORE any JWT is issued. Signal the frontend with `mfaRequired: true` so it
  // can reveal the code field.
  if (user.mfa_enabled) {
    const mfaCode = String(req.body?.mfaCode || '').trim()
    if (!mfaCode) {
      // Password was correct but the second factor is still owed — don't count
      // this as a brute-force failure (the frontend just needs to reveal the field).
      res.status(401).json({ error: 'MFA code required', mfaRequired: true })
      return
    }
    if (!verifyTOTP(user.mfa_secret, mfaCode, { window: 1 })) {
      loginLockout.recordFailure(lockKey)
      res.status(401).json({ error: 'Invalid MFA code', mfaRequired: true })
      return
    }
  }

  // Successful authentication — clear any recorded failures for this identity+IP.
  loginLockout.reset(lockKey)

  // "Keep me signed in" → 30 day token; otherwise → 1 day
  const expiresIn = remember ? '30d' : '1d'
  const token = issueToken(user, expiresIn)
  // JL-132: record successful logins in the tamper-evident audit log.
  safeAppendAudit({ actor: user.email, action: 'login', target: user.email, metadata: { remember: Boolean(remember) } })
  res.json({ user: { id: user.id, email: user.email, createdAt: user.created_at }, token, remember })
}))

// --- Forgot Password: request reset ---
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()

  if (!isAllowedEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid email address' })
    return
  }

  const user = await get('SELECT id, email FROM users WHERE email = ?', [email])
  if (!user) {
    // Don't reveal whether the email exists — return success either way
    res.json({ message: 'If an account exists with that email, a reset link has been generated.' })
    return
  }

  // Invalidate any existing unused tokens for this user
  await run('UPDATE password_reset_tokens SET used = TRUE WHERE user_id = ? AND used = FALSE', [user.id])

  // Generate a secure reset token (valid for 15 minutes)
  const resetToken = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  await run(
    'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [user.id, resetToken, expiresAt],
  )

  // Send the reset link by email (best-effort, fire-and-forget — never block the
  // response on SMTP). sendMail() itself never throws; the catch is a safety net.
  const { subject, html, text } = buildPasswordResetEmail({ token: resetToken })
  sendMail({ to: user.email, subject, html, text }).catch((err) => {
    console.error(`[auth] Failed to send password reset email: ${err.message}`)
  })

  const responseBody = {
    message: 'If an account exists with that email, a reset link has been generated.',
    expiresIn: '15 minutes',
  }
  // Only expose the raw token in the response when SMTP is NOT configured, so
  // dev/testing still works without a mail server. In production (SMTP set), the
  // token is delivered exclusively by email and never leaked in the API response.
  if (!isSmtpConfigured()) {
    responseBody.resetToken = resetToken
  }

  res.json(responseBody)
}))

// --- Reset Password: use token to set new password ---
router.post('/reset-password', asyncHandler(async (req, res) => {
  const token = String(req.body?.token || '').trim()
  const newPassword = String(req.body?.newPassword || '')

  if (!token) {
    res.status(400).json({ error: 'Reset token is required' })
    return
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters' })
    return
  }

  const resetRow = await get(
    'SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = ?',
    [token],
  )

  if (!resetRow) {
    res.status(400).json({ error: 'Invalid or expired reset token' })
    return
  }
  if (resetRow.used) {
    res.status(400).json({ error: 'This reset token has already been used' })
    return
  }
  if (new Date(resetRow.expires_at) < new Date()) {
    res.status(400).json({ error: 'Reset token has expired. Please request a new one.' })
    return
  }

  // Update the password
  const passwordHash = hashPassword(newPassword)
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, resetRow.user_id])

  // Mark token as used
  await run('UPDATE password_reset_tokens SET used = TRUE WHERE id = ?', [resetRow.id])

  res.json({ message: 'Password has been reset successfully. You can now log in.' })
}))

// --- Get current user info with roles ---
router.get('/me', authGuard, loadUserRoles, asyncHandler(async (req, res) => {
  const { id, email, memberId, workspaceRole, isOwner } = req.user

  // Fetch profile if it exists
  const profile = await get(
    'SELECT full_name, job_title, department, timezone, avatar_url FROM profile WHERE user_id = ?',
    [id],
  )

  // Fetch all project roles for this user
  const projectRoles = memberId
    ? await all(
        `SELECT pm.project_id AS projectId, p.key AS projectKey, p.name AS projectName, pm.role
         FROM project_members pm
         JOIN projects p ON p.id = pm.project_id
         WHERE pm.member_id = ?
         ORDER BY p.name ASC`,
        [memberId],
      )
    : []

  res.json({
    id,
    email,
    memberId,
    workspaceRole,
    isOwner,
    profile: profile || null,
    projectRoles,
  })
}))

/* ============================================================
   JL-81: Multi-Factor Authentication (TOTP / RFC 6238)
   ============================================================ */

// --- Setup: generate + persist a fresh secret (NOT yet enabled) ---
// Returns the base32 secret and an otpauth:// URL for the authenticator app.
// The user must confirm a code via /mfa/enable before MFA takes effect.
router.post('/mfa/setup', authGuard, asyncHandler(async (req, res) => {
  const user = await get('SELECT id, email FROM users WHERE id = ?', [req.user.id])
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const secret = generateSecret()
  await run('UPDATE users SET mfa_secret = ?, mfa_enabled = FALSE WHERE id = ?', [secret, user.id])

  res.json({
    secret,
    otpauthUrl: getOtpAuthUrl(secret, user.email),
  })
}))

// --- Enable: verify a code against the stored secret, then flip the flag on ---
router.post('/mfa/enable', authGuard, asyncHandler(async (req, res) => {
  const code = String(req.body?.code || req.body?.mfaCode || '').trim()
  const user = await get('SELECT id, mfa_secret, mfa_enabled FROM users WHERE id = ?', [req.user.id])
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }
  if (!user.mfa_secret) {
    res.status(400).json({ error: 'Run MFA setup first' })
    return
  }
  if (!code) {
    res.status(400).json({ error: 'Verification code is required' })
    return
  }
  if (!verifyTOTP(user.mfa_secret, code, { window: 1 })) {
    res.status(401).json({ error: 'Invalid verification code' })
    return
  }

  await run('UPDATE users SET mfa_enabled = TRUE WHERE id = ?', [user.id])
  res.json({ enabled: true, message: 'Two-factor authentication enabled' })
}))

// --- Disable: turn MFA off and clear the secret ---
router.post('/mfa/disable', authGuard, asyncHandler(async (req, res) => {
  await run('UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL WHERE id = ?', [req.user.id])
  res.json({ enabled: false, message: 'Two-factor authentication disabled' })
}))

// --- Status: is MFA currently enabled for the signed-in user? ---
router.get('/mfa/status', authGuard, asyncHandler(async (req, res) => {
  const user = await get('SELECT mfa_enabled FROM users WHERE id = ?', [req.user.id])
  res.json({ enabled: Boolean(user?.mfa_enabled) })
}))

/* ============================================================
   JL-81: OAuth / SSO scaffold (config-gated)
   ------------------------------------------------------------
   These endpoints are structured for a standard Authorization-Code flow but
   only activate when a provider's client id + secret are set in the env
   (see server/config.js). Without config they respond 501 so the feature can
   ship dark and be enabled per-deployment. No live provider calls run in tests.
   ============================================================ */

// --- Step 1: redirect the user to the provider's consent screen ---
router.get('/oauth/:provider', asyncHandler(async (req, res) => {
  const providerName = req.params.provider
  const provider = getOAuthProvider(providerName)
  if (!provider) {
    res.status(404).json({ error: `Unknown OAuth provider: ${providerName}` })
    return
  }
  if (!isOAuthConfigured(providerName)) {
    res.status(501).json({ error: `OAuth provider '${providerName}' is not configured` })
    return
  }

  const redirectUri = `${OAUTH_REDIRECT_BASE}/api/auth/oauth/${providerName}/callback`
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: provider.scope,
    // CSRF state — in a full impl this is persisted and validated on callback.
    state: crypto.randomBytes(16).toString('hex'),
  })
  const authorizeUrl = `${provider.authorizeUrl}?${params.toString()}`

  // Return the URL (SPA-friendly) rather than a 302 so the frontend controls navigation.
  res.json({ authorizeUrl })
}))

// --- Step 2: provider redirects back here with ?code=... ---
// Full flow (guarded behind config): exchange code → fetch profile → upsert
// user + oauth_identity → issue JWT. Left as a documented no-op without config.
router.get('/oauth/:provider/callback', asyncHandler(async (req, res) => {
  const providerName = req.params.provider
  const provider = getOAuthProvider(providerName)
  if (!provider) {
    res.status(404).json({ error: `Unknown OAuth provider: ${providerName}` })
    return
  }
  if (!isOAuthConfigured(providerName)) {
    res.status(501).json({ error: `OAuth provider '${providerName}' is not configured` })
    return
  }

  const code = String(req.query?.code || '')
  if (!code) {
    res.status(400).json({ error: 'Missing authorization code' })
    return
  }

  // --- Below is the intended flow, gated so it never runs without live config ---
  //   1. POST provider.tokenUrl with { code, client_id, client_secret, redirect_uri }
  //      → { access_token }
  //   2. GET provider.userInfoUrl with the bearer access_token → { email, sub/id }
  //   3. Upsert the user by email, then upsert oauth_identities:
  //        const identity = await get(
  //          'SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?',
  //          [providerName, providerUserId],
  //        )
  //        let userId = identity?.user_id
  //        if (!userId) {
  //          let u = await get('SELECT id FROM users WHERE email = ?', [email])
  //          if (!u) {
  //            const created = await run(
  //              'INSERT INTO users (email, password_hash) VALUES (?, ?)',
  //              [email, hashPassword(crypto.randomBytes(24).toString('hex'))],
  //            )
  //            u = { id: created.lastID }
  //          }
  //          userId = u.id
  //          await run(
  //            'INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
  //            [userId, providerName, providerUserId],
  //          )
  //        }
  //   4. issueToken({ id: userId, email }) and redirect to the SPA with the token.
  //
  // Until a live provider is wired up we return 501 to make the gate explicit.
  res.status(501).json({ error: 'OAuth callback handling is not enabled in this environment' })
}))

/* ============================================================
   JL-129: Live SSO — OIDC (openid-client v6) & SAML 2.0 (@node-saml/node-saml v5)
   ------------------------------------------------------------
   Real login flows that activate only when an IdP is configured (see
   isOidcConfigured / isSamlConfigured in config.js). When unconfigured every
   endpoint responds 501 — identical dark-ship behaviour to the JL-81 OAuth
   scaffold, so dev/test never touch a live IdP.

   The heavy library calls (issuer discovery, code exchange, SAML response
   validation) are LAZY-imported inside each handler so this module always
   imports cleanly under vitest without pulling openid-client's ESM/network path.
   Persistence is delegated to the pure `upsertSsoUser` helper.
   ============================================================ */

// Short-lived in-memory store for OIDC per-request CSRF material
// (state → { codeVerifier, nonce }). MVP single-instance; entries auto-expire.
const oidcStateStore = new Map()
const OIDC_STATE_TTL_MS = 10 * 60 * 1000

function rememberOidcState(state, data) {
  const now = Date.now()
  // Opportunistic cleanup of expired entries.
  for (const [key, val] of oidcStateStore) {
    if (now - val.ts > OIDC_STATE_TTL_MS) oidcStateStore.delete(key)
  }
  oidcStateStore.set(state, { ...data, ts: now })
}

function takeOidcState(state) {
  const val = oidcStateStore.get(state)
  if (!val) return null
  oidcStateStore.delete(state)
  if (Date.now() - val.ts > OIDC_STATE_TTL_MS) return null
  return val
}

// --- Discoverability: which SSO methods are live in this deployment? ---
router.get('/sso/status', (req, res) => {
  res.json({ oidc: isOidcConfigured(), saml: isSamlConfigured() })
})

// --- OIDC step 1: build the authorization URL (state + nonce + PKCE) ---
router.get('/sso/oidc', asyncHandler(async (req, res) => {
  if (!isOidcConfigured()) {
    res.status(501).json({ error: 'OIDC SSO is not configured' })
    return
  }

  const client = await import('openid-client')
  const cfg = getOidcConfig()
  const config = await client.discovery(new URL(cfg.issuerUrl), cfg.clientId, cfg.clientSecret)

  const codeVerifier = client.randomPKCECodeVerifier()
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
  const state = client.randomState()
  const nonce = client.randomNonce()
  rememberOidcState(state, { codeVerifier, nonce })

  const authorizeUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: cfg.redirectUri,
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  })

  // Return the URL (SPA controls navigation), matching the JL-81 OAuth style.
  res.json({ authorizeUrl: authorizeUrl.href })
}))

// --- OIDC step 2: exchange the code, upsert user + identity, issue JWT ---
router.get('/sso/oidc/callback', asyncHandler(async (req, res) => {
  if (!isOidcConfigured()) {
    res.status(501).json({ error: 'OIDC SSO is not configured' })
    return
  }

  const state = String(req.query?.state || '')
  const stored = takeOidcState(state)
  if (!stored) {
    res.status(400).json({ error: 'Invalid or expired SSO state' })
    return
  }

  const client = await import('openid-client')
  const cfg = getOidcConfig()
  const config = await client.discovery(new URL(cfg.issuerUrl), cfg.clientId, cfg.clientSecret)

  // Reconstruct the callback URL with the IdP-provided query params.
  const currentUrl = new URL(cfg.redirectUri)
  for (const [k, v] of Object.entries(req.query || {})) {
    currentUrl.searchParams.set(k, String(v))
  }

  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: stored.codeVerifier,
    expectedState: state,
    expectedNonce: stored.nonce,
    idTokenExpected: true,
  })

  const claims = tokens.claims() || {}
  const email = String(claims.email || '').trim().toLowerCase()
  if (!email) {
    res.status(400).json({ error: 'OIDC identity did not include an email claim' })
    return
  }

  const user = await upsertSsoUser(
    { email, provider: 'oidc', providerUserId: claims.sub },
    { get, run },
  )

  // Redirect back to the SPA with the app JWT (matches JL-81 callback intent).
  const token = issueToken(user, '7d')
  res.redirect(`${APP_URL}/?sso_token=${encodeURIComponent(token)}`)
}))

// --- SAML step 1: redirect to the IdP with a signed/authn request URL ---
router.get('/sso/saml', asyncHandler(async (req, res) => {
  if (!isSamlConfigured()) {
    res.status(501).json({ error: 'SAML SSO is not configured' })
    return
  }

  const { SAML } = await import('@node-saml/node-saml')
  const cfg = getSamlConfig()
  const saml = new SAML({
    entryPoint: cfg.entryPoint,
    issuer: cfg.issuer,
    idpCert: cfg.cert,
    callbackUrl: cfg.callbackUrl,
    wantAuthnResponseSigned: false,
  })

  const authorizeUrl = await saml.getAuthorizeUrlAsync('', undefined, {})
  res.json({ authorizeUrl })
}))

// --- SAML step 2: validate the SAMLResponse, upsert user + identity, issue JWT ---
router.post('/sso/saml/callback', asyncHandler(async (req, res) => {
  if (!isSamlConfigured()) {
    res.status(501).json({ error: 'SAML SSO is not configured' })
    return
  }

  const { SAML } = await import('@node-saml/node-saml')
  const cfg = getSamlConfig()
  const saml = new SAML({
    entryPoint: cfg.entryPoint,
    issuer: cfg.issuer,
    idpCert: cfg.cert,
    callbackUrl: cfg.callbackUrl,
    wantAuthnResponseSigned: false,
  })

  const { profile } = await saml.validatePostResponseAsync(req.body || {})
  if (!profile) {
    res.status(400).json({ error: 'SAML response did not contain a profile' })
    return
  }

  const email = String(profile.email || profile.mail || profile.nameID || '').trim().toLowerCase()
  if (!email) {
    res.status(400).json({ error: 'SAML identity did not include an email or nameID' })
    return
  }

  const user = await upsertSsoUser(
    { email, provider: 'saml', providerUserId: profile.nameID || email },
    { get, run },
  )

  const token = issueToken(user, '7d')
  res.redirect(`${APP_URL}/?sso_token=${encodeURIComponent(token)}`)
}))

export default router
