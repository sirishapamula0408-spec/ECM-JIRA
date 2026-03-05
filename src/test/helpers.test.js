import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseStoredAuthUser, displayNameFromEmail, getActivityVisual } from '../utils/helpers'

describe('parseStoredAuthUser', () => {
  const store = {}
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k])
    vi.stubGlobal('localStorage', {
      getItem: (key) => store[key] ?? null,
      setItem: (key, val) => { store[key] = String(val) },
      removeItem: (key) => { delete store[key] },
    })
  })

  it('returns null when no stored user', () => {
    expect(parseStoredAuthUser()).toBeNull()
  })

  it('returns parsed user object', () => {
    const user = { id: 1, email: 'test@test.com' }
    localStorage.setItem('jira_auth_user', JSON.stringify(user))
    expect(parseStoredAuthUser()).toEqual(user)
  })

  it('returns null for invalid JSON', () => {
    localStorage.setItem('jira_auth_user', 'not-json')
    expect(parseStoredAuthUser()).toBeNull()
  })
})

describe('displayNameFromEmail', () => {
  it('extracts and capitalizes name from email', () => {
    expect(displayNameFromEmail('john.doe@company.com')).toBe('John Doe')
  })

  it('returns User for empty/null input', () => {
    expect(displayNameFromEmail('')).toBe('User')
    expect(displayNameFromEmail(null)).toBe('User')
    expect(displayNameFromEmail(undefined)).toBe('User')
  })
})

describe('getActivityVisual', () => {
  it('returns visual config for known action types', () => {
    const moved = getActivityVisual('moved')
    expect(moved.kind).toBe('moved')
    expect(moved.glyph).toBe('->')

    const created = getActivityVisual('created')
    expect(created.kind).toBe('created')
    expect(created.glyph).toBe('+')
  })

  it('returns default for unknown action', () => {
    const unknown = getActivityVisual('somethingelse')
    expect(unknown.kind).toBe('default')
  })
})
