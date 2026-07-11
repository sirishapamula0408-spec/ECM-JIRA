// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Mock the db layer so no live PostgreSQL is needed. ---
// migrations.js and seed.js both import run/get/all from ../db.js.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn(),
}))

import { run, get, all } from '../db.js'
import {
  hasMigration,
  recordMigration,
  listMigrations,
  runMigration,
} from '../services/migrations.js'
import { seedDemoData } from '../seed.js'

const ORIGINAL_SEED_FLAG = process.env.SEED_DEMO_DATA

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  if (ORIGINAL_SEED_FLAG === undefined) {
    delete process.env.SEED_DEMO_DATA
  } else {
    process.env.SEED_DEMO_DATA = ORIGINAL_SEED_FLAG
  }
})

/* ================================================================
   1. hasMigration
   ================================================================ */
describe('hasMigration', () => {
  it('returns true when a row exists for the version', async () => {
    get.mockResolvedValue({ '?column?': 1 })
    const result = await hasMigration('baseline')
    expect(result).toBe(true)
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining('FROM schema_migrations'),
      ['baseline'],
    )
  })

  it('returns false when no row exists', async () => {
    get.mockResolvedValue(null)
    const result = await hasMigration('does-not-exist')
    expect(result).toBe(false)
  })
})

/* ================================================================
   2. recordMigration
   ================================================================ */
describe('recordMigration', () => {
  it('inserts the version + name', async () => {
    run.mockResolvedValue({ lastID: 1, changes: 1 })
    await recordMigration('v-2026-01', 'add widgets table')
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO schema_migrations'),
      ['v-2026-01', 'add widgets table'],
    )
    // Idempotency guard is present in the SQL.
    expect(run.mock.calls[0][0]).toMatch(/ON CONFLICT/i)
  })

  it('defaults name to empty string when omitted', async () => {
    run.mockResolvedValue({ lastID: 1, changes: 1 })
    await recordMigration('v-noname')
    expect(run).toHaveBeenCalledWith(expect.any(String), ['v-noname', ''])
  })
})

/* ================================================================
   3. listMigrations
   ================================================================ */
describe('listMigrations', () => {
  it('returns the recorded migrations ordered', async () => {
    const rows = [
      { version: 'baseline', name: 'init', applied_at: '2026-01-01' },
      { version: 'v-2026-02', name: 'x', applied_at: '2026-02-01' },
    ]
    all.mockResolvedValue(rows)
    const result = await listMigrations()
    expect(result).toEqual(rows)
    expect(all).toHaveBeenCalledWith(expect.stringContaining('ORDER BY applied_at'))
  })
})

/* ================================================================
   4. runMigration
   ================================================================ */
describe('runMigration', () => {
  it('runs fn and records the version when NOT already applied', async () => {
    get.mockResolvedValue(null) // hasMigration -> false
    run.mockResolvedValue({ lastID: 1, changes: 1 })
    const fn = vi.fn().mockResolvedValue(undefined)

    const ran = await runMigration('v-new', 'create thing', fn)

    expect(ran).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
    // The record INSERT happened.
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO schema_migrations'),
      ['v-new', 'create thing'],
    )
  })

  it('SKIPS fn (and does not re-record) when already applied', async () => {
    get.mockResolvedValue({ '?column?': 1 }) // hasMigration -> true
    const fn = vi.fn()

    const ran = await runMigration('baseline', 'noop', fn)

    expect(ran).toBe(false)
    expect(fn).not.toHaveBeenCalled()
    // No INSERT should have been issued.
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================================================================
   5. Seed gate — seedDemoData
   ================================================================ */
describe('seedDemoData (SEED_DEMO_DATA gate)', () => {
  it('does nothing when SEED_DEMO_DATA is unset (no inserts)', async () => {
    delete process.env.SEED_DEMO_DATA
    const result = await seedDemoData()
    expect(result).toEqual({ seeded: false })
    expect(run).not.toHaveBeenCalled()
  })

  it('does nothing when SEED_DEMO_DATA is explicitly false', async () => {
    process.env.SEED_DEMO_DATA = 'false'
    const result = await seedDemoData()
    expect(result.seeded).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the seeders only when SEED_DEMO_DATA is explicitly true', async () => {
    process.env.SEED_DEMO_DATA = 'true'
    // Empty tables so every seeder proceeds; return shapes the seeders expect.
    get.mockResolvedValue({ count: 0 })
    all.mockResolvedValue([])
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const result = await seedDemoData()

    expect(result.seeded).toBe(true)
    // Inserts actually happened.
    expect(run).toHaveBeenCalled()
    const insertCalls = run.mock.calls.filter((c) => /INSERT INTO/i.test(c[0]))
    expect(insertCalls.length).toBeGreaterThan(0)
  })
})
