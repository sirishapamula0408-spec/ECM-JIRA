import { all, get } from '../db.js'

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
//
// JL-306: `options.cancelFromAny` + `options.cancelStatus` express the QA-lifecycle
// "cancel from any non-terminal state" capability. When enabled, a move INTO the
// cancel status is always allowed from a non-terminal state, even if no explicit
// transition row exists for it. `options.terminalStatuses` marks states that can no
// longer transition (Done/Cancelled).
export function isTransitionAllowed(transitions, from, to, options = {}) {
  if (from === to) return true
  const { cancelFromAny = false, cancelStatus = null, terminalStatuses = [] } = options || {}
  const terminal = Array.isArray(terminalStatuses) ? terminalStatuses : []
  // Cancel-from-any: allow the cancel transition from any non-terminal state.
  if (cancelFromAny && cancelStatus && to === cancelStatus && !terminal.includes(from)) {
    return true
  }
  // Terminal states have no outgoing transitions.
  if (terminal.includes(from)) return false
  if (!Array.isArray(transitions) || transitions.length === 0) return true
  return transitions.some((t) => t.from_status === from && t.to_status === to)
}

// JL-306: normalise a project_workflows metadata row into cancel/terminal options
// for isTransitionAllowed(). Returns {} when there is no default workflow.
export function cancelOptionsFromMeta(meta) {
  if (!meta) return {}
  return {
    cancelFromAny: meta.cancel_from_any === true || meta.cancel_from_any === 't' || meta.cancel_from_any === 1,
    cancelStatus: meta.cancel_status ?? null,
    terminalStatuses: normalizeList(meta.terminal_statuses),
  }
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

// JL-306: load the project's DEFAULT workflow metadata row (initial/terminal states,
// cancel-from-any). Returns null when the project has no configured workflow, in
// which case the engine falls back to the transition-list-only behaviour.
export async function loadWorkflowMeta(projectId) {
  if (!projectId) return null
  return get(
    'SELECT * FROM project_workflows WHERE project_id = ? AND is_default = TRUE ORDER BY id DESC LIMIT 1',
    [projectId],
  )
}
