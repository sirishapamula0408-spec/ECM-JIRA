import crypto from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { get, run } from '../db.js'
import { JWT_SECRET } from '../config.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { isAllowedEmail, hashPassword, verifyPassword } from '../middleware/validate.js'

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
  await run('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', [user.id])

  // Generate a secure reset token (valid for 15 minutes)
  const resetToken = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  await run(
    'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [user.id, resetToken, expiresAt],
  )

  // In a real app, send an email with the token. Here we return it directly for demo purposes.
  res.json({
    message: 'If an account exists with that email, a reset link has been generated.',
    resetToken,
    expiresIn: '15 minutes',
  })
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
  await run('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetRow.id])

  res.json({ message: 'Password has been reset successfully. You can now log in.' })
}))

export default router
