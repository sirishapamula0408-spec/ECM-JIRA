import crypto from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { get, run, all } from '../db.js'
import { JWT_SECRET, getOAuthProvider, isOAuthConfigured, OAUTH_REDIRECT_BASE } from '../config.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { isAllowedEmail, hashPassword, verifyPassword } from '../middleware/validate.js'
import { authGuard } from '../middleware/authGuard.js'
import { loadUserRoles } from '../middleware/authorize.js'
import { sendMail, buildPasswordResetEmail, isSmtpConfigured } from '../utils/mailer.js'
import { generateSecret, getOtpAuthUrl, verifyTOTP } from '../services/totp.js'

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

  const user = await get(
    'SELECT id, email, password_hash, created_at, mfa_enabled, mfa_secret FROM users WHERE email = ?',
    [email],
  )
  if (!user || !verifyPassword(password, user.password_hash)) {
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
      res.status(401).json({ error: 'MFA code required', mfaRequired: true })
      return
    }
    if (!verifyTOTP(user.mfa_secret, mfaCode, { window: 1 })) {
      res.status(401).json({ error: 'Invalid MFA code', mfaRequired: true })
      return
    }
  }

  // "Keep me signed in" → 30 day token; otherwise → 1 day
  const expiresIn = remember ? '30d' : '1d'
  const token = issueToken(user, expiresIn)
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

export default router
