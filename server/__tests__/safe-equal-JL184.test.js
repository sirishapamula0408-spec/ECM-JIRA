// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { safeEqual } from '../utils/safeEqual.js'

/* ================================================================
   JL-184: constant-time secret comparison helper
   ================================================================ */
describe('safeEqual', () => {
  it('returns true for identical non-empty strings', () => {
    expect(safeEqual('super-secret-token', 'super-secret-token')).toBe(true)
  })

  it('returns false for different same-length strings', () => {
    expect(safeEqual('abcdefg', 'abcdefh')).toBe(false)
    expect(safeEqual('topsecret', 'topsecre7')).toBe(false)
  })

  it('returns false for different-length strings (no throw)', () => {
    expect(safeEqual('short', 'a-much-longer-secret')).toBe(false)
    expect(safeEqual('a-much-longer-secret', 'short')).toBe(false)
  })

  it('treats empty / null / undefined as non-matching', () => {
    expect(safeEqual('', '')).toBe(false)
    expect(safeEqual('', 'x')).toBe(false)
    expect(safeEqual('x', '')).toBe(false)
    expect(safeEqual(null, null)).toBe(false)
    expect(safeEqual(undefined, undefined)).toBe(false)
    expect(safeEqual(null, 'x')).toBe(false)
    expect(safeEqual('x', undefined)).toBe(false)
  })

  it('compares Buffers as well as strings', () => {
    expect(safeEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true)
    expect(safeEqual(Buffer.from('abc'), 'abc')).toBe(true)
    expect(safeEqual(Buffer.from('abc'), Buffer.from('abd'))).toBe(false)
  })

  it('is unicode-safe (byte comparison, no throw on multibyte)', () => {
    expect(safeEqual('café', 'café')).toBe(true)
    expect(safeEqual('café', 'cafe')).toBe(false)
  })
})
