import { describe, it, expect } from 'vitest'
import { isAllowedEmail, hashPassword, verifyPassword } from '../middleware/validate.js'

describe('isAllowedEmail', () => {
  it('accepts valid email addresses', () => {
    expect(isAllowedEmail('user@gmail.com')).toBe(true)
    expect(isAllowedEmail('test@company.org')).toBe(true)
    expect(isAllowedEmail('first.last@work.co')).toBe(true)
  })

  it('rejects invalid email addresses', () => {
    expect(isAllowedEmail('')).toBe(false)
    expect(isAllowedEmail('notanemail')).toBe(false)
    expect(isAllowedEmail('@nodomain')).toBe(false)
    expect(isAllowedEmail('no@tld')).toBe(false)
    expect(isAllowedEmail(null)).toBe(false)
    expect(isAllowedEmail(undefined)).toBe(false)
  })
})

describe('hashPassword / verifyPassword', () => {
  it('hashes and verifies correctly', () => {
    const hash = hashPassword('mypassword')
    expect(typeof hash).toBe('string')
    expect(hash).toContain(':')
    expect(verifyPassword('mypassword', hash)).toBe(true)
  })

  it('rejects wrong password', () => {
    const hash = hashPassword('correct')
    expect(verifyPassword('wrong', hash)).toBe(false)
  })

  it('handles empty/invalid stored hash', () => {
    expect(verifyPassword('test', '')).toBe(false)
    expect(verifyPassword('test', null)).toBe(false)
    expect(verifyPassword('test', 'nocolon')).toBe(false)
  })
})
