import crypto from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { get, run, all } from '../db.js'
import { JWT_SECRET } from '../config.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { isAllowedEmail, hashPassword, verifyPassword } from '../middleware/validate.js'
import { authGuard } from '../middleware/authGuard.js'
import { loadUserRoles } from '../middleware/authorize.js'
import { sendMail, buildPasswordResetEmail, isSmtpConfigured } from '../utils/mailer.js'

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

  const user = await get('SELECT id, email, password_hash, created_at FROM users WHERE email = ?', [email])
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password' })
    return
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

export default router
