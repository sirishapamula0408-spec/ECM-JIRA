import { all } from '../db.js'

// JL-79: Configurable workflow engine.
// Pure, testable helpers plus a thin loader. The engine is BACKWARD COMPATIBLE:
// a project with no transitions configured allows every status change (legacy behavior).

export const VALIDATOR_TYPES = ['required_field']
export const POST_FUNCTION_TYPES = ['set_field', 'add_comment']

// Whitelist of issue columns a `set_field` post-function may write. Guards against
// SQL injection since the column name is interpolated into the UPDATE statement.
export const SETTABLE_FIELDS = ['assignee', 'priority', 'resolution', 'environment', 'components']

// JSONB columns arrive already parsed from pg; strings/null are tolerated for safety.
function normalizeList(value) {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined || value === '') return []
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === ''
}

// True if the transition is permitted. No transitions configured => allow all
// (backward compat). A no-op (from === to) is always allowed.
export function isTransitionAllowed(transitions, from, to) {
  if (!Array.isArray(transitions) || transitions.length === 0) return true
  if (from === to) return true
  return transitions.some((t) => t.from_status === from && t.to_status === to)
}

// Find the transition row matching from -> to (or null).
export function findTransition(transitions, from, to) {
  if (!Array.isArray(transitions)) return null
  return transitions.find((t) => t.from_status === from && t.to_status === to) || null
}

// Run a transition's validators against the issue (merged with the incoming patch).
// Returns an array of human-readable error strings; empty means valid.
export function runValidators(transition, issue = {}, patch = {}) {
  const errors = []
  if (!transition) return errors
  const merged = { ...issue, ...patch }
  for (const validator of normalizeList(transition.validators)) {
    if (validator?.type === 'required_field' && validator.field) {
      if (isBlank(merged[validator.field])) {
        errors.push(`Field "${validator.field}" is required to transition to ${transition.to_status}`)
      }
    }
  }
  return errors
}

// Apply a transition's post-functions directly to the DB. Loop-safe: writes go
// straight to the issues/comments tables and never re-invoke the engine (mirrors
// the automation.js pattern). `db` is injected ({ run }) for testability.
export async function applyPostFunctions(transition, issueId, db) {
  const applied = []
  if (!transition) return applied
  for (const fn of normalizeList(transition.post_functions)) {
    if (fn?.type === 'set_field' && fn.field && SETTABLE_FIELDS.includes(fn.field)) {
      await db.run(`UPDATE issues SET ${fn.field} = ? WHERE id = ?`, [fn.value ?? null, issueId])
      applied.push(`set ${fn.field}`)
    } else if (fn?.type === 'add_comment' && fn.text) {
      await db.run('INSERT INTO comments (issue_id, author, text) VALUES (?, ?, ?)', [issueId, 'Workflow', fn.text])
      applied.push('added comment')
    }
  }
  return applied
}

// Load the configured transitions for a project (empty array when none / no project).
export async function loadTransitions(projectId) {
  if (!projectId) return []
  return all('SELECT * FROM workflow_transitions WHERE project_id = ?', [projectId])
}
