import { describe, it, expect } from 'vitest'
import { dueStatus, parseDueDate } from '../utils/dueStatus'

// Fixed reference "today" for deterministic results
const NOW = new Date(2026, 6, 10, 14, 30) // Jul 10 2026, 2:30pm local

describe('dueStatus (JL-167)', () => {
  it('returns null when no due date is set', () => {
    expect(dueStatus(null, NOW)).toBeNull()
    expect(dueStatus(undefined, NOW)).toBeNull()
    expect(dueStatus('', NOW)).toBeNull()
  })

  it('returns null for invalid date values', () => {
    expect(dueStatus('not-a-date', NOW)).toBeNull()
  })

  it('returns "overdue" for a past date', () => {
    expect(dueStatus('2026-07-09', NOW)).toBe('overdue')
    expect(dueStatus('2026-01-01', NOW)).toBe('overdue')
  })

  it('returns "soon" when due today', () => {
    expect(dueStatus('2026-07-10', NOW)).toBe('soon')
  })

  it('returns "soon" when due within 3 days', () => {
    expect(dueStatus('2026-07-11', NOW)).toBe('soon')
    expect(dueStatus('2026-07-13', NOW)).toBe('soon')
  })

  it('returns "later" when due beyond 3 days', () => {
    expect(dueStatus('2026-07-14', NOW)).toBe('later')
    expect(dueStatus('2026-12-25', NOW)).toBe('later')
  })

  it('handles ISO timestamp strings via the date part', () => {
    expect(dueStatus('2026-07-09T00:00:00.000Z', NOW)).toBe('overdue')
    expect(dueStatus('2026-07-12T23:59:59.000Z', NOW)).toBe('soon')
    expect(dueStatus('2026-08-01T00:00:00.000Z', NOW)).toBe('later')
  })

  it('handles Date instances', () => {
    expect(dueStatus(new Date(2026, 6, 8), NOW)).toBe('overdue')
    expect(dueStatus(new Date(2026, 6, 12), NOW)).toBe('soon')
    expect(dueStatus(new Date(2026, 7, 1), NOW)).toBe('later')
  })
})

describe('parseDueDate (JL-167)', () => {
  it('parses YYYY-MM-DD as local midnight', () => {
    const parsed = parseDueDate('2026-07-15')
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(6)
    expect(parsed.getDate()).toBe(15)
    expect(parsed.getHours()).toBe(0)
  })

  it('returns null for empty or invalid input', () => {
    expect(parseDueDate(null)).toBeNull()
    expect(parseDueDate('garbage')).toBeNull()
  })
})
