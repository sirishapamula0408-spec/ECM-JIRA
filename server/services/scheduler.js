import { all, run } from '../db.js'
import { executeAction, logExecution } from './automation.js'

// --- JL-119: Scheduled (time-based) automation triggers ---
// A dependency-free, in-process scheduler. Scheduled rules run on a fixed
// interval (schedule_interval_minutes) rather than in response to an event.
// Like the event engine, actions apply directly to the DB and never re-invoke
// the automation engine, so scheduled runs stay loop-safe.

function toMs(value) {
  if (value instanceof Date) return value.getTime()
  return new Date(value).getTime()
}

// PURE + UNIT-TESTABLE: given a list of rule rows and the current time, return
// only the scheduled rules that are due to run. `now` is injected (no time dep).
// A rule is due when it has never run, or when at least its interval has elapsed
// since last_run_at. Non-scheduled rules and rules with an invalid interval are excluded.
export function dueRules(rules, now) {
  const nowMs = toMs(now)
  return (rules || []).filter((rule) => {
    if (!rule || rule.trigger_type !== 'scheduled') return false
    const interval = Number(rule.schedule_interval_minutes)
    if (!Number.isFinite(interval) || interval <= 0) return false
    if (!rule.last_run_at) return true
    const lastMs = toMs(rule.last_run_at)
    if (!Number.isFinite(lastMs)) return true
    return nowMs - lastMs >= interval * 60 * 1000
  })
}

// Load enabled scheduled rules, run each due rule against its matching issues via
// the existing automation engine, then stamp last_run_at. Each rule is guarded so a
// single failing rule cannot abort the whole cycle; failures are recorded in automation_logs.
export async function runScheduledRules(now = new Date()) {
  const rules = await all(
    "SELECT * FROM automation_rules WHERE trigger_type = 'scheduled' AND enabled = TRUE",
    [],
  )
  const due = dueRules(rules, now)
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString()

  for (const rule of due) {
    try {
      // condition_value optionally scopes the rule to issues in a given status;
      // empty means all issues in the project.
      let sql = 'SELECT * FROM issues WHERE project_id = ?'
      const params = [rule.project_id]
      if (rule.condition_value) {
        sql += ' AND status = ?'
        params.push(rule.condition_value)
      }
      const issues = await all(sql, params)

      for (const issue of issues) {
        try {
          const message = await executeAction(rule, issue)
          await logExecution(rule.id, issue.id, 'success', message)
        } catch (err) {
          await logExecution(rule.id, issue.id, 'failure', err.message || 'Action failed')
        }
      }

      await run('UPDATE automation_rules SET last_run_at = ? WHERE id = ?', [nowIso, rule.id])
    } catch (err) {
      await logExecution(rule.id, null, 'failure', err.message || 'Scheduled run failed')
    }
  }

  return due.length
}

let timer = null

// Start the in-process interval. setInterval only — no external scheduler dep.
// Guarded against double-start; unref()'d so it never keeps the process alive.
export function startScheduler({ intervalMs = 60000 } = {}) {
  if (timer) return timer
  timer = setInterval(() => {
    runScheduledRules(new Date()).catch((err) => {
      console.error('Scheduled automation run failed:', err)
    })
  }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
