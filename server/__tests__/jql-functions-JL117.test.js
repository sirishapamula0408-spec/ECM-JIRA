import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db module — capture SQL + params passed to all()
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { all } from '../db.js'
import {
  parseJql,
  parseJqlAsync,
  buildIssueSearch,
  buildIssueSearchAsync,
} from '../services/jqlSearch.js'

beforeEach(() => {
  vi.clearAllMocks()
  all.mockResolvedValue([])
})

/* ==================================================================
   currentUser()
   ================================================================== */
describe('currentUser()', () => {
  it('binds the current user as a param (sync parseJql)', () => {
    const { where, params } = parseJql('assignee = currentUser()', {
      currentUser: 'sirisha@x.com',
    })
    expect(where).toBe('assignee = ?')
    expect(params).toEqual(['sirisha@x.com'])
    // The identity is never interpolated into the SQL string.
    expect(where).not.toContain('sirisha@x.com')
  })

  it('binds the current user via the async builder', async () => {
    const { where, params } = await buildIssueSearchAsync({
      jql: 'assignee = currentUser()',
      currentUser: 'me@test.com',
    })
    expect(where).toBe('WHERE (assignee = ?)')
    expect(params).toEqual(['me@test.com'])
  })

  it('supports != currentUser()', () => {
    const { where, params } = parseJql('assignee != currentUser()', {
      currentUser: 'bob@x.com',
    })
    expect(where).toBe('assignee != ?')
    expect(params).toEqual(['bob@x.com'])
  })

  it('throws 400 when no authenticated user is supplied', () => {
    let thrown
    try {
      parseJql('assignee = currentUser()')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
    expect(thrown.status).toBe(400)
  })
})

/* ==================================================================
   membersOf("Role")
   ================================================================== */
describe('membersOf()', () => {
  it('expands to an IN (...) of the member list, all bound', async () => {
    all.mockResolvedValueOnce([
      { name: 'Alice', email: 'alice@x.com' },
      { name: 'Bob', email: 'bob@x.com' },
    ])
    const { where, params } = await parseJqlAsync('assignee IN membersOf("Admin")')

    // No interpolation: only placeholders in the SQL string.
    expect(where).toBe('assignee IN (?, ?, ?, ?)')
    expect(where).not.toContain('Admin')
    expect(where).not.toContain('alice@x.com')

    // Every identity survives as a bound param.
    expect(params).toEqual(['alice@x.com', 'Alice', 'bob@x.com', 'Bob'])

    // The role argument itself was bound (never interpolated) in the lookup.
    const [sql, lookupParams] = all.mock.calls[0]
    expect(sql).toMatch(/FROM members/i)
    expect(sql).toContain('?')
    expect(lookupParams).toEqual(['Admin'])
  })

  it('maps `=` to IN and `!=` to NOT IN for a member set', async () => {
    all.mockResolvedValue([{ name: 'Ann', email: 'ann@x.com' }])
    const eq = await parseJqlAsync('assignee = membersOf("Dev")')
    expect(eq.where).toBe('assignee IN (?, ?)')

    const neq = await parseJqlAsync('assignee != membersOf("Dev")')
    expect(neq.where).toBe('assignee NOT IN (?, ?)')
    expect(neq.params).toEqual(['ann@x.com', 'Ann'])
  })

  it('produces a no-match predicate for an empty member set (no interpolation)', async () => {
    all.mockResolvedValueOnce([])
    const { where, params } = await parseJqlAsync('assignee IN membersOf("Ghosts")')
    expect(where).toBe('1=0')
    expect(params).toEqual([])
  })

  it('sync parseJql refuses membersOf (needs DB) with 400', () => {
    let thrown
    try {
      parseJql('assignee IN membersOf("Admin")')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
    expect(thrown.status).toBe(400)
  })
})

/* ==================================================================
   linkedIssues("KEY")
   ================================================================== */
describe('linkedIssues()', () => {
  it('resolves linked issue keys via issue_links and binds them (issue IN ...)', async () => {
    all.mockResolvedValueOnce([{ val: 'ECM-2' }, { val: 'ECM-3' }])
    const { where, params } = await parseJqlAsync('issue IN linkedIssues("ECM-1")')

    expect(where).toBe('issue_key IN (?, ?)')
    expect(where).not.toContain('ECM-2')
    expect(params).toEqual(['ECM-2', 'ECM-3'])

    // The lookup goes through issue_links with the KEY bound (never interpolated).
    const [sql, lookupParams] = all.mock.calls[0]
    expect(sql).toMatch(/issue_links/i)
    expect(sql).not.toContain('ECM-1')
    expect(lookupParams).toEqual(['ECM-1', 'ECM-1', 'ECM-1'])
  })

  it('supports reporter = linkedIssues(...) mapping = to IN', async () => {
    all.mockResolvedValueOnce([{ val: 'ECM-9' }])
    const { where, params } = await parseJqlAsync('reporter = linkedIssues("ECM-4")')
    expect(where).toBe('reporter IN (?)')
    expect(params).toEqual(['ECM-9'])
  })

  it('empty link set yields a no-match predicate', async () => {
    all.mockResolvedValueOnce([])
    const { where } = await parseJqlAsync('issue IN linkedIssues("ECM-404")')
    expect(where).toBe('1=0')
  })
})

/* ==================================================================
   Date functions
   ================================================================== */
describe('date functions', () => {
  const fixedNow = new Date('2026-07-08T15:30:00.000Z')

  it('now() compiles to a bound ISO timestamp', () => {
    const { where, params } = parseJql('created >= now()', { now: fixedNow })
    expect(where).toBe('created_at >= ?')
    expect(params).toEqual([fixedNow.toISOString()])
    // The timestamp is bound, never interpolated.
    expect(where).not.toContain('2026')
  })

  it('startOfDay() truncates to midnight and binds a timestamp', () => {
    const { where, params } = parseJql('created >= startOfDay()', { now: fixedNow })
    expect(where).toBe('created_at >= ?')
    const bound = new Date(params[0])
    expect(bound.getHours()).toBe(0)
    expect(bound.getMinutes()).toBe(0)
    expect(bound.getSeconds()).toBe(0)
    expect(params).toHaveLength(1)
    expect(typeof params[0]).toBe('string')
  })

  it('startOfWeek() binds a timestamp param', () => {
    const { where, params } = parseJql('created >= startOfWeek()', { now: fixedNow })
    expect(where).toBe('created_at >= ?')
    expect(params).toHaveLength(1)
    expect(new Date(params[0]).toString()).not.toBe('Invalid Date')
  })

  it('relative offset -7d compiles to a bound timestamp 7 days back', () => {
    const { where, params } = parseJql('created > -7d', { now: fixedNow })
    expect(where).toBe('created_at > ?')
    const bound = new Date(params[0])
    const expected = new Date(fixedNow)
    expected.setDate(expected.getDate() - 7)
    expect(bound.getTime()).toBe(expected.getTime())
  })

  it('relative offset +3d compiles to a bound timestamp 3 days forward', () => {
    const { params } = parseJql('due <= +3d', { now: fixedNow })
    const bound = new Date(params[0])
    const expected = new Date(fixedNow)
    expected.setDate(expected.getDate() + 3)
    expect(bound.getTime()).toBe(expected.getTime())
  })
})

/* ==================================================================
   Whitelist: unknown functions rejected
   ================================================================== */
describe('unknown functions → 400', () => {
  it('rejects an unknown function name (sync)', () => {
    let thrown
    try {
      parseJql('assignee = dropTables()')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
    expect(thrown.status).toBe(400)
    expect(thrown.message).toMatch(/Unknown function/i)
  })

  it('rejects an unknown function name (async) and does not hit the db', async () => {
    let thrown
    try {
      await parseJqlAsync('assignee = evil("x")')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
    expect(thrown.status).toBe(400)
    expect(all).not.toHaveBeenCalled()
  })
})

/* ==================================================================
   No user value is ever string-interpolated
   ================================================================== */
describe('safety — everything is bound, nothing interpolated', () => {
  it('a malicious membersOf role argument is bound, not interpolated', async () => {
    const evil = "Admin'); DROP TABLE issues;--"
    all.mockResolvedValueOnce([])
    await parseJqlAsync(`assignee IN membersOf("${evil}")`)
    const [sql, lookupParams] = all.mock.calls[0]
    expect(sql).not.toContain('DROP TABLE')
    expect(lookupParams).toEqual([evil])
  })

  it('a malicious linkedIssues key is bound, not interpolated', async () => {
    const evil = "ECM-1'; DELETE FROM issues;--"
    all.mockResolvedValueOnce([])
    await parseJqlAsync(`issue IN linkedIssues("${evil}")`)
    const [sql, lookupParams] = all.mock.calls[0]
    expect(sql).not.toContain('DELETE FROM')
    expect(lookupParams).toEqual([evil, evil, evil])
  })

  it('combines currentUser() with a plain clause, all params bound in order', async () => {
    const { where, params } = await buildIssueSearchAsync({
      jql: 'assignee = currentUser() AND status = "In Progress"',
      currentUser: 'me@test.com',
    })
    expect(where).toBe('WHERE (assignee = ? AND status = ?)')
    expect(params).toEqual(['me@test.com', 'In Progress'])
  })

  it('buildIssueSearch (sync) still binds a plain jql clause unchanged', () => {
    const { where, params } = buildIssueSearch({ jql: 'status = Done' })
    expect(where).toBe('WHERE (status = ?)')
    expect(params).toEqual(['Done'])
  })
})
