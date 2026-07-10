import { describe, it, expect, vi, beforeEach } from 'vitest'

/*
 * JL-94 — withTransaction() unit tests.
 *
 * We mock `pg` so db.js builds its pool from a fake Pool whose connect()
 * hands back a controllable client. That lets us assert the BEGIN → callback →
 * COMMIT happy path, the ROLLBACK + rethrow failure path, and that the client
 * is always released — without touching a real database.
 */

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}

const mockPool = {
  connect: vi.fn(async () => mockClient),
  query: vi.fn(),
  on: vi.fn(),
  end: vi.fn(),
}

vi.mock('pg', () => ({
  default: { Pool: vi.fn(function Pool() { return mockPool }) },
}))

// Import AFTER the mock is registered so db.js picks up the fake pool.
const { withTransaction } = await import('../db.js')

beforeEach(() => {
  vi.clearAllMocks()
  // Default: every query resolves to an empty result set.
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 })
})

describe('withTransaction — happy path', () => {
  it('checks out a client, runs BEGIN, the callback, then COMMIT, and releases', async () => {
    const order = []
    mockClient.query.mockImplementation(async (sql) => {
      order.push(String(sql).split(/\s/)[0].toUpperCase())
      return { rows: [], rowCount: 0 }
    })

    const result = await withTransaction(async (tx) => {
      expect(tx).toHaveProperty('run')
      expect(tx).toHaveProperty('get')
      expect(tx).toHaveProperty('all')
      order.push('CALLBACK')
      return 'done'
    })

    expect(mockPool.connect).toHaveBeenCalledTimes(1)
    expect(result).toBe('done')
    // BEGIN precedes the callback, which precedes COMMIT.
    expect(order[0]).toBe('BEGIN')
    expect(order).toContain('CALLBACK')
    expect(order[order.length - 1]).toBe('COMMIT')
    expect(order.indexOf('BEGIN')).toBeLessThan(order.indexOf('CALLBACK'))
    expect(order.indexOf('CALLBACK')).toBeLessThan(order.indexOf('COMMIT'))
    // No rollback on success; client always released.
    expect(mockClient.query).not.toHaveBeenCalledWith('ROLLBACK')
    expect(mockClient.release).toHaveBeenCalledTimes(1)
  })

  it('never issues a ROLLBACK when the callback succeeds', async () => {
    await withTransaction(async () => 42)
    const rolledBack = mockClient.query.mock.calls.some((c) => c[0] === 'ROLLBACK')
    expect(rolledBack).toBe(false)
  })
})

describe('withTransaction — failure path', () => {
  it('rolls back and rethrows when the callback throws', async () => {
    const boom = new Error('callback exploded')

    await expect(
      withTransaction(async () => {
        throw boom
      }),
    ).rejects.toBe(boom)

    const calls = mockClient.query.mock.calls.map((c) => c[0])
    expect(calls).toContain('BEGIN')
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
    // Client is still released after a failure.
    expect(mockClient.release).toHaveBeenCalledTimes(1)
  })

  it('releases the client even if COMMIT itself fails', async () => {
    const commitErr = new Error('commit failed')
    mockClient.query.mockImplementation(async (sql) => {
      if (sql === 'COMMIT') throw commitErr
      return { rows: [], rowCount: 0 }
    })

    await expect(withTransaction(async () => 'x')).rejects.toBe(commitErr)

    const calls = mockClient.query.mock.calls.map((c) => c[0])
    expect(calls).toContain('ROLLBACK')
    expect(mockClient.release).toHaveBeenCalledTimes(1)
  })
})

describe('withTransaction — tx.run/get/all interface', () => {
  it('tx.run converts ? placeholders, appends RETURNING id, and returns { lastID, changes }', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (/^\s*INSERT/i.test(sql)) return { rows: [{ id: 99 }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })

    let runResult
    await withTransaction(async (tx) => {
      runResult = await tx.run('INSERT INTO members (name, email) VALUES (?, ?)', ['A', 'a@x.com'])
    })

    // Find the INSERT call the tx issued.
    const insertCall = mockClient.query.mock.calls.find((c) => /INSERT/i.test(c[0]))
    expect(insertCall[0]).toContain('$1')
    expect(insertCall[0]).toContain('$2')
    expect(insertCall[0]).toMatch(/RETURNING id\s*$/)
    expect(insertCall[1]).toEqual(['A', 'a@x.com'])
    expect(runResult).toEqual({ lastID: 99, changes: 1 })
  })

  it('tx.get returns the first row (or null) and tx.all returns every row', async () => {
    mockClient.query.mockImplementation(async (sql) => {
      if (/FROM many/i.test(sql)) return { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 }
      if (/FROM none/i.test(sql)) return { rows: [], rowCount: 0 }
      return { rows: [{ id: 7 }], rowCount: 1 }
    })

    let one, none, many
    await withTransaction(async (tx) => {
      one = await tx.get('SELECT id FROM one WHERE id = ?', [7])
      none = await tx.get('SELECT id FROM none WHERE id = ?', [0])
      many = await tx.all('SELECT id FROM many')
    })

    expect(one).toEqual({ id: 7 })
    expect(none).toBeNull()
    expect(many).toEqual([{ id: 1 }, { id: 2 }])
  })
})
