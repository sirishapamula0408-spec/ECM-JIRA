// @vitest-environment node
// JL-179 — unit tests for the shared route validation helpers.
import { describe, it, expect } from 'vitest'
import validation, {
  isPresent,
  requireFields,
  oneOf,
  isEmail,
} from '../utils/validation.js'

describe('isPresent', () => {
  it('treats undefined/null/empty-string/whitespace as missing', () => {
    expect(isPresent(undefined)).toBe(false)
    expect(isPresent(null)).toBe(false)
    expect(isPresent('')).toBe(false)
    expect(isPresent('   ')).toBe(false)
  })

  it('treats non-empty strings and non-string values as present', () => {
    expect(isPresent('x')).toBe(true)
    expect(isPresent('  x  ')).toBe(true)
    expect(isPresent(0)).toBe(true)
    expect(isPresent(false)).toBe(true)
    expect(isPresent([])).toBe(true)
    expect(isPresent({})).toBe(true)
  })
})

describe('requireFields', () => {
  it('returns ok when all required fields are present', () => {
    const r = requireFields({ name: 'a', email: 'b@c.com' }, ['name', 'email'])
    expect(r.ok).toBe(true)
    expect(r.errors).toHaveLength(0)
  })

  it('reports each missing field as "<field> is required" in order', () => {
    const r = requireFields({ email: '' }, ['name', 'email'])
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual(['name is required', 'email is required'])
  })

  it('treats whitespace-only strings as missing', () => {
    const r = requireFields({ name: '   ' }, ['name'])
    expect(r.errors).toEqual(['name is required'])
  })

  it('accepts falsy-but-present values like 0 and false', () => {
    const r = requireFields({ count: 0, flag: false }, ['count', 'flag'])
    expect(r.ok).toBe(true)
  })

  it('tolerates missing/empty args', () => {
    expect(requireFields().ok).toBe(true)
    expect(requireFields(null, ['name']).errors).toEqual(['name is required'])
  })
})

describe('oneOf', () => {
  const allowed = ['active', 'inactive', 'retired']
  it('returns true only for members of the allow-list', () => {
    expect(oneOf('active', allowed)).toBe(true)
    expect(oneOf('retired', allowed)).toBe(true)
    expect(oneOf('exploded', allowed)).toBe(false)
  })

  it('is strict about type/identity and tolerates a non-array allow-list', () => {
    expect(oneOf(1, ['1'])).toBe(false)
    expect(oneOf('x', undefined)).toBe(false)
    expect(oneOf('x', null)).toBe(false)
  })
})

describe('isEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isEmail('a@b.com')).toBe(true)
    expect(isEmail('customer@acme.co.uk')).toBe(true)
  })

  it('rejects malformed or non-string input', () => {
    expect(isEmail('not-an-email')).toBe(false)
    expect(isEmail('a@b')).toBe(false)
    expect(isEmail('a b@c.com')).toBe(false)
    expect(isEmail('')).toBe(false)
    expect(isEmail(null)).toBe(false)
    expect(isEmail(123)).toBe(false)
  })
})

describe('default export', () => {
  it('exposes all helpers', () => {
    expect(typeof validation.isPresent).toBe('function')
    expect(typeof validation.requireFields).toBe('function')
    expect(typeof validation.oneOf).toBe('function')
    expect(typeof validation.isEmail).toBe('function')
  })
})
