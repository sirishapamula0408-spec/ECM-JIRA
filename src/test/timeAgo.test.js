import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { timeAgo } from '../utils/timeAgo'

// Fixed "current" moment so every range assertion is deterministic.
const NOW = new Date('2026-07-10T12:00:00.000Z')

function secondsBefore(s) {
  return new Date(NOW.getTime() - s * 1000)
}

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('just now', () => {
    it('returns "Just now" for the current moment', () => {
      expect(timeAgo(NOW)).toBe('Just now')
    })

    it('returns "Just now" under 10 seconds', () => {
      expect(timeAgo(secondsBefore(9))).toBe('Just now')
    })

    it('returns "Just now" for future dates', () => {
      expect(timeAgo(new Date(NOW.getTime() + 60_000))).toBe('Just now')
    })
  })

  describe('seconds', () => {
    it('formats 10 seconds', () => {
      expect(timeAgo(secondsBefore(10))).toBe('10s ago')
    })

    it('formats 59 seconds', () => {
      expect(timeAgo(secondsBefore(59))).toBe('59s ago')
    })
  })

  describe('minutes', () => {
    it('formats 1 minute', () => {
      expect(timeAgo(secondsBefore(60))).toBe('1m ago')
    })

    it('formats 45 minutes', () => {
      expect(timeAgo(secondsBefore(45 * 60))).toBe('45m ago')
    })

    it('formats 59 minutes', () => {
      expect(timeAgo(secondsBefore(59 * 60 + 59))).toBe('59m ago')
    })
  })

  describe('hours', () => {
    it('formats 1 hour', () => {
      expect(timeAgo(secondsBefore(60 * 60))).toBe('1h ago')
    })

    it('formats 23 hours', () => {
      expect(timeAgo(secondsBefore(23 * 3600))).toBe('23h ago')
    })
  })

  describe('days', () => {
    it('formats 1 day', () => {
      expect(timeAgo(secondsBefore(24 * 3600))).toBe('1d ago')
    })

    it('formats 6 days', () => {
      expect(timeAgo(secondsBefore(6 * 24 * 3600))).toBe('6d ago')
    })
  })

  describe('weeks', () => {
    it('formats 7 days as 1 week', () => {
      expect(timeAgo(secondsBefore(7 * 24 * 3600))).toBe('1w ago')
    })

    it('formats 29 days as 4 weeks', () => {
      expect(timeAgo(secondsBefore(29 * 24 * 3600))).toBe('4w ago')
    })
  })

  describe('months', () => {
    it('formats 30 days as 1 month', () => {
      expect(timeAgo(secondsBefore(30 * 24 * 3600))).toBe('1mo ago')
    })

    it('formats 180 days as 6 months', () => {
      expect(timeAgo(secondsBefore(180 * 24 * 3600))).toBe('6mo ago')
    })

    it('formats 364 days as 12 months', () => {
      expect(timeAgo(secondsBefore(364 * 24 * 3600))).toBe('12mo ago')
    })
  })

  describe('years', () => {
    it('formats 365 days as 1 year', () => {
      expect(timeAgo(secondsBefore(365 * 24 * 3600))).toBe('1y ago')
    })

    it('formats ~2.5 years as 2 years', () => {
      expect(timeAgo(secondsBefore(Math.floor(2.5 * 365) * 24 * 3600))).toBe('2y ago')
    })
  })

  describe('input types', () => {
    it('accepts an ISO string', () => {
      expect(timeAgo('2026-07-10T09:00:00.000Z')).toBe('3h ago')
    })

    it('accepts a Date instance', () => {
      expect(timeAgo(new Date('2026-07-08T12:00:00.000Z'))).toBe('2d ago')
    })

    it('accepts epoch milliseconds', () => {
      expect(timeAgo(NOW.getTime() - 5 * 60_000)).toBe('5m ago')
    })
  })

  describe('invalid input', () => {
    it('returns empty string for null', () => {
      expect(timeAgo(null)).toBe('')
    })

    it('returns empty string for undefined', () => {
      expect(timeAgo(undefined)).toBe('')
    })

    it('returns empty string for empty string', () => {
      expect(timeAgo('')).toBe('')
    })

    it('returns empty string for an unparseable string', () => {
      expect(timeAgo('not-a-date')).toBe('')
    })

    it('returns empty string for an invalid Date instance', () => {
      expect(timeAgo(new Date('garbage'))).toBe('')
    })
  })
})
