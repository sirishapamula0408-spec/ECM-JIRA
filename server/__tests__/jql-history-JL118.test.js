import { describe, it, expect } from 'vitest'
import { parseJql } from '../services/jqlSearch.js'

/* ==================================================================
   JL-118 — JQL history operators (WAS, CHANGED, WAS IN)
   Unit-test the parser/builder in server/services/jqlSearch.js.
   ================================================================== */

describe('parseJql — WAS operator', () => {
  it('status WAS "Done" compiles to an EXISTS issue_history subquery with bound field + value', () => {
    const { where, params } = parseJql('status WAS "Done"')
    expect(where).toContain('EXISTS')
    expect(where).toContain('FROM issue_history')
    expect(where).toContain('h.issue_id = i.id')
    expect(where).toContain('h.field = ?')
    // matches either old_value or new_value ever equal to the target
    expect(where).toContain('h.old_value IN (?)')
    expect(where).toContain('h.new_value IN (?)')
    // field name is bound first, then the value once per column
    expect(params).toEqual(['status', 'Done', 'Done'])
    // the value never leaks into the SQL string
    expect(where).not.toContain('Done')
  })

  it('binds a bare (unquoted) value', () => {
    const { where, params } = parseJql('status WAS Done')
    expect(where).toContain('EXISTS')
    expect(params).toEqual(['status', 'Done', 'Done'])
  })

  it('maps type -> tracked history field "type"', () => {
    const { params } = parseJql('type WAS Bug')
    expect(params[0]).toBe('type')
    expect(params).toEqual(['type', 'Bug', 'Bug'])
  })

  it('handles quoted multi-word values', () => {
    const { params } = parseJql('status WAS "In Progress"')
    expect(params).toEqual(['status', 'In Progress', 'In Progress'])
  })
})

describe('parseJql — CHANGED operator', () => {
  it('assignee CHANGED compiles to an EXISTS on field presence (no value bound)', () => {
    const { where, params } = parseJql('assignee CHANGED')
    expect(where).toContain('EXISTS')
    expect(where).toContain('FROM issue_history')
    expect(where).toContain('h.issue_id = i.id')
    expect(where).toContain('h.field = ?')
    expect(where).not.toContain('old_value')
    expect(where).not.toContain('new_value')
    // only the field name is bound
    expect(params).toEqual(['assignee'])
  })
})

describe('parseJql — WAS IN operator', () => {
  it('binds every value in the list (twice: old_value + new_value columns)', () => {
    const { where, params } = parseJql('status WAS IN ("To Do", "In Progress")')
    expect(where).toContain('EXISTS')
    expect(where).toContain('h.old_value IN (?, ?)')
    expect(where).toContain('h.new_value IN (?, ?)')
    // field, then list for old_value, then list for new_value
    expect(params).toEqual(['status', 'To Do', 'In Progress', 'To Do', 'In Progress'])
    expect(where).not.toContain('To Do')
  })

  it('handles a single-element list', () => {
    const { params } = parseJql('priority WAS IN ("High")')
    expect(params).toEqual(['priority', 'High', 'High'])
  })

  it('handles bare (unquoted) list items', () => {
    const { params } = parseJql('status WAS IN (Backlog, Done)')
    expect(params).toEqual(['status', 'Backlog', 'Done', 'Backlog', 'Done'])
  })
})

describe('parseJql — combining history with normal clauses', () => {
  it('AND-combines a history clause with a current-state clause, params in order', () => {
    const { where, params } = parseJql('status WAS "Done" AND priority = High')
    expect(where).toContain('EXISTS')
    expect(where).toContain(' AND ')
    expect(where).toContain('priority = ?')
    // history params first, then the current-state value
    expect(params).toEqual(['status', 'Done', 'Done', 'High'])
  })

  it('OR-combines two history clauses', () => {
    const { where, params } = parseJql('status WAS "Done" OR assignee CHANGED')
    expect(where).toContain(' OR ')
    expect(params).toEqual(['status', 'Done', 'Done', 'assignee'])
  })

  it('applies ORDER BY after a history clause', () => {
    const { orderBy, params } = parseJql('assignee CHANGED ORDER BY priority DESC')
    expect(orderBy).toBe('priority DESC')
    expect(params).toEqual(['assignee'])
  })
})

describe('parseJql — history operator safety & validation', () => {
  it('binds an injection payload instead of interpolating it', () => {
    const evil = "x'; DROP TABLE issue_history;--"
    const { where, params } = parseJql(`status WAS "${evil}"`)
    expect(where).not.toContain('DROP TABLE')
    expect(where).not.toContain(evil)
    // payload survives verbatim as a bound param
    expect(params).toEqual(['status', evil, evil])
    // still only placeholders in the SQL
    expect(where).toContain('IN (?)')
  })

  it('injection in a WAS IN list is bound, not interpolated', () => {
    const evil = "'); DELETE FROM issues;--"
    const { where, params } = parseJql(`status WAS IN ("${evil}", "Done")`)
    expect(where).not.toContain('DELETE FROM issues')
    expect(params).toEqual(['status', evil, 'Done', evil, 'Done'])
  })

  it('rejects a non-tracked field with a history operator (400)', () => {
    let thrown
    try {
      parseJql('project WAS 5')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
    expect(thrown.status).toBe(400)
    expect(thrown.message).toMatch(/not tracked/i)
  })

  it('rejects CHANGED on a non-tracked field (400)', () => {
    let thrown
    try {
      parseJql('key CHANGED')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
    expect(thrown.status).toBe(400)
  })
})

describe('parseJql — existing operators still work', () => {
  it('plain equality is unchanged', () => {
    const { where, params } = parseJql('status = Done')
    expect(where).toBe('status = ?')
    expect(params).toEqual(['Done'])
  })

  it('~ contains is unchanged', () => {
    const { where, params } = parseJql('title ~ login')
    expect(where).toBe('title ILIKE ?')
    expect(params).toEqual(['%login%'])
  })
})
