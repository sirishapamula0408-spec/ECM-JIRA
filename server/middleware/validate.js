import crypto from 'node:crypto'

export const validStatuses = ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done']
export const validPriorities = ['Low', 'Medium', 'High']
export const validIssueTypes = ['Story', 'Bug', 'Task']

export function isAllowedEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return false
  const parts = normalized.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (!local || !domain || !domain.includes('.')) return false
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  const [salt, expectedHash] = String(stored || '').split(':')
  if (!salt || !expectedHash) return false
  const actualHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'))
}
