import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db module so no live DB is touched (matches other __tests__ suites).
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
}))

// Mock the automation engine helpers the scheduler reuses, so runScheduledRules
// can be observed without executing real actions or notifications.
vi.mock('../services/automation.js', () => ({
  executeAction: vi.fn(),
  logExecution: vi.fn(),
}))

import { run, all } from '../db.js'
import { executeAction, logExecution } from '../services/automation.js'
import { dueRules, runScheduledRules } from '../services/scheduler.js'

function rule(overrides = {}) {
  return {
    id: 1,
    project_id: 10,
    name: 'Stale sweep',
    trigger_type: 'scheduled',
    condition_value: '',
    action_type: 'notify',
    action_value: '',
    enabled: true,
    schedule_interval_minutes: 60,
    last_run_at: null,
    ...overrides,
  }
}

const NOW = new Date('2026-07-10T12:00:00.000Z')

describe('JL-119 dueRules (pure)', () => {
  it('returns rules that have never run', () => {
    const r = rule({ last_run_at: null })
    expect(dueRules([r], NOW)).toEqual([r])
  })

  it('returns rules whose interval has elapsed', () => {
    // last run 90 min ago, interval 60 → due
    const r = rule({ schedule_interval_minutes: 60, last_run_at: '2026-07-10T10:30:00.000Z' })
    expect(dueRules([r], NOW)).toEqual([r])
  })

  it('excludes rules run recently (< interval)', () => {
    // last run 10 min ago, interval 60 → not due
    const r = rule({ schedule_interval_minutes: 60, last_run_at: '2026-07-10T11:50:00.000Z' })
    expect(dueRules([r], NOW)).toEqual([])
  })

  it('includes a rule exactly at the interval boundary', () => {
    const r = rule({ schedule_interval_minutes: 60, last_run_at: '2026-07-10T11:00:00.000Z' })
    expect(dueRules([r], NOW)).toEqual([r])
  })

  it('ignores non-scheduled triggers', () => {
    const evt = rule({ trigger_type: 'status_changed', last_run_at: null })
    expect(dueRules([evt], NOW)).toEqual([])
  })

  it('ignores scheduled rules with a non-positive/invalid interval', () => {
    expect(dueRules([rule({ schedule_interval_minutes: 0 })], NOW)).toEqual([])
    expect(dueRules([rule({ schedule_interval_minutes: -5 })], NOW)).toEqual([])
    expect(dueRules([rule({ schedule_interval_minutes: null })], NOW)).toEqual([])
  })
})

describe('JL-119 runScheduledRules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs the action on matching issues, logs success, and stamps last_run_at', async () => {
    const r = rule({ id: 7, project_id: 10, condition_value: '', last_run_at: null })
    // 1st all() → scheduled rules; 2nd all() → matching issues for the rule
    all.mockResolvedValueOnce([r])
    all.mockResolvedValueOnce([{ id: 100, project_id: 10 }, { id: 101, project_id: 10 }])
    executeAction.mockResolvedValue('did the thing')

    const count = await runScheduledRules(NOW)

    expect(count).toBe(1)
    expect(executeAction).toHaveBeenCalledTimes(2)
    expect(logExecution).toHaveBeenCalledWith(7, 100, 'success', 'did the thing')
    expect(logExecution).toHaveBeenCalledWith(7, 101, 'success', 'did the thing')
    // last_run_at stamped with the injected now
    expect(run).toHaveBeenCalledWith(
      'UPDATE automation_rules SET last_run_at = ? WHERE id = ?',
      [NOW.toISOString(), 7],
    )
  })

  it('scopes issues by condition_value status when set', async () => {
    const r = rule({ id: 8, project_id: 10, condition_value: 'In Progress' })
    all.mockResolvedValueOnce([r])
    all.mockResolvedValueOnce([])

    await runScheduledRules(NOW)

    // second all() call carries the status filter
    expect(all).toHaveBeenNthCalledWith(
      2,
      'SELECT * FROM issues WHERE project_id = ? AND status = ?',
      [10, 'In Progress'],
    )
  })

  it('logs a failure when an action throws but still stamps last_run_at', async () => {
    const r = rule({ id: 9, project_id: 10, last_run_at: null })
    all.mockResolvedValueOnce([r])
    all.mockResolvedValueOnce([{ id: 200, project_id: 10 }])
    executeAction.mockRejectedValueOnce(new Error('boom'))

    await runScheduledRules(NOW)

    expect(logExecution).toHaveBeenCalledWith(9, 200, 'failure', 'boom')
    expect(run).toHaveBeenCalledWith(
      'UPDATE automation_rules SET last_run_at = ? WHERE id = ?',
      [NOW.toISOString(), 9],
    )
  })

  it('skips rules that are not yet due (no issue query, no stamp)', async () => {
    const r = rule({ id: 11, schedule_interval_minutes: 60, last_run_at: '2026-07-10T11:55:00.000Z' })
    all.mockResolvedValueOnce([r])

    const count = await runScheduledRules(NOW)

    expect(count).toBe(0)
    expect(all).toHaveBeenCalledTimes(1) // only the rules query, no issue query
    expect(executeAction).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
})
