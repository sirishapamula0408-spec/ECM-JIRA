import { Router } from 'express'
import { get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

function displayNameFromEmail(email) {
  const local = String(email || '').split('@')[0] || ''
  if (!local) return 'User'
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.id
  const email = req.user.email

  let row = await get('SELECT id, full_name, job_title, department, timezone, avatar_url, user_id FROM profile WHERE user_id = ?', [userId])

  if (!row) {
    // Auto-create a profile for this user
    const defaultName = displayNameFromEmail(email)
    await run(
      'INSERT INTO profile (full_name, job_title, department, timezone, avatar_url, user_id) VALUES (?, ?, ?, ?, ?, ?)',
      [defaultName, '', '', '(GMT+05:30) India Standard Time', '', userId]
    )
    row = await get('SELECT id, full_name, job_title, department, timezone, avatar_url, user_id FROM profile WHERE user_id = ?', [userId])
  }

  res.json({ ...row, email })
}))

router.put('/', asyncHandler(async (req, res) => {
  const userId = req.user.id
  const email = req.user.email
  const { full_name, job_title, department, timezone, avatar_url } = req.body

  // Ensure profile exists
  const existing = await get('SELECT id FROM profile WHERE user_id = ?', [userId])
  if (!existing) {
    const defaultName = displayNameFromEmail(email)
    await run(
      'INSERT INTO profile (full_name, job_title, department, timezone, avatar_url, user_id) VALUES (?, ?, ?, ?, ?, ?)',
      [defaultName, '', '', '(GMT+05:30) India Standard Time', '', userId]
    )
  }

  await run('UPDATE profile SET full_name = ?, job_title = ?, department = ?, timezone = ?, avatar_url = ? WHERE user_id = ?', [
    full_name,
    job_title,
    department,
    timezone,
    avatar_url || '',
    userId,
  ])
  const row = await get('SELECT id, full_name, job_title, department, timezone, avatar_url, user_id FROM profile WHERE user_id = ?', [userId])
  res.json({ ...row, email })
}))

export default router
