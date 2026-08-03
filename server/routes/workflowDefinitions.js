import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { listTemplates, getTemplate } from '../services/workflowTemplates.js'
import { materializeProjectStatuses } from './issueConfig.js'

// JL-306: Named workflow definitions API.
//  - Built-in templates (the QA Lifecycle) can be listed and applied to a project.
//  - Custom workflows can be created/edited: name, initial state, terminal state(s),
//    a cancel-from-any flag, and which one is the project default.
// States + the transition graph live in issue_statuses + workflow_transitions; this
// router manages the project_workflows metadata rows and the apply-template seeding.

const router = Router()

function mapWorkflow(row) {
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    initialStatus: row.initial_status,
    terminalStatuses: Array.isArray(row.terminal_statuses)
      ? row.terminal_statuses
      : (row.terminal_statuses ?? []),
    cancelFromAny: row.cancel_from_any === true || row.cancel_from_any === 't' || row.cancel_from_any === 1,
    cancelStatus: row.cancel_status,
    isDefault: row.is_default === true || row.is_default === 't' || row.is_default === 1,
    createdAt: row.created_at,
  }
}

function normalizeTerminal(value) {
  if (Array.isArray(value)) return value.map((s) => String(s)).filter(Boolean)
  return []
}

// GET /api/workflow-templates — built-in reusable workflow definitions
router.get('/workflow-templates', asyncHandler(async (_req, res) => {
  res.json(listTemplates())
}))

// GET /api/projects/:projectId/workflow-definitions — this project's named workflows
router.get('/projects/:projectId/workflow-definitions', asyncHandler(async (req, res) => {
  const rows = await all(
    'SELECT * FROM project_workflows WHERE project_id = ? ORDER BY is_default DESC, id ASC',
    [Number(req.params.projectId)],
  )
  res.json(rows.map(mapWorkflow))
}))

// Insert missing project statuses for a set of state definitions ({ name, category, color }).
//
// JL-332: this only ever looked at `WHERE project_id = ?`, so applying a template
// to a project still using the global defaults seeded the template's states and
// left every global status not in the template — notably "Code Review" — invisible,
// even with issues still sitting in it. Materialise the effective set first so the
// template ADDS to what the project had rather than silently replacing it.
async function ensureStatuses(projectId, states) {
  await materializeProjectStatuses(projectId)

  const existing = await all(
    'SELECT LOWER(name) AS lname FROM issue_statuses WHERE project_id = ?',
    [projectId],
  )
  const have = new Set(existing.map((r) => r.lname))
  let position = existing.length
  for (const st of states) {
    const name = typeof st === 'string' ? st : st?.name
    if (!name || have.has(name.toLowerCase())) continue
    const category = (typeof st === 'object' && st?.category) || 'todo'
    // JL-324: default to a light surface token, not the N500 text token.
    const color = (typeof st === 'object' && st?.color) || '#F4F5F7'
    await run(
      'INSERT INTO issue_statuses (project_id, name, position, color, category) VALUES (?, ?, ?, ?, ?)',
      [projectId, name, position, color, category],
    )
    have.add(name.toLowerCase())
    position += 1
  }
}

// Insert transitions ([from,to] pairs or {fromStatus,toStatus}) skipping duplicates.
async function ensureTransitions(projectId, transitions) {
  for (const t of transitions) {
    const fromStatus = Array.isArray(t) ? t[0] : t?.fromStatus
    const toStatus = Array.isArray(t) ? t[1] : t?.toStatus
    if (!fromStatus || !toStatus || fromStatus === toStatus) continue
    const dup = await get(
      'SELECT id FROM workflow_transitions WHERE project_id = ? AND from_status = ? AND to_status = ?',
      [projectId, fromStatus, toStatus],
    )
    if (dup) continue
    await run(
      'INSERT INTO workflow_transitions (project_id, from_status, to_status, validators, post_functions) VALUES (?, ?, ?, ?::jsonb, ?::jsonb)',
      [projectId, fromStatus, toStatus, '[]', '[]'],
    )
  }
}

// Upsert the project_workflows metadata row; when isDefault, clears the flag on others.
//
// JL-324: this used to be INSERT-only despite the name, so every Apply-template /
// Publish click appended another row — one project accumulated three workflows
// including two identical "QA Lifecycle" entries. Update in place when a workflow
// of the same name already exists for the project (case-insensitive).
async function upsertWorkflowMeta(projectId, meta) {
  if (meta.isDefault) {
    await run('UPDATE project_workflows SET is_default = FALSE WHERE project_id = ?', [projectId])
  }

  const terminal = JSON.stringify(normalizeTerminal(meta.terminalStatuses))
  const existing = await get(
    'SELECT id FROM project_workflows WHERE project_id = ? AND LOWER(name) = LOWER(?)',
    [projectId, meta.name],
  )

  if (existing) {
    // JL-331: only write fields the caller actually supplied. The first version
    // of this UPDATE (JL-324) set all five columns unconditionally, so a Publish
    // — which sends name/initialStatus/terminalStatuses and nothing else —
    // coerced cancelFromAny to false and cancelStatus to null. That silently
    // disabled cancel-from-any, and with no explicit '-> Cancelled' edge in the
    // template it made cancelling an issue impossible (409 from
    // isTransitionAllowed). `undefined` now means "leave unchanged".
    const sets = []
    const params = []
    if (meta.initialStatus !== undefined) {
      sets.push('initial_status = ?')
      params.push(meta.initialStatus ?? null)
    }
    if (meta.terminalStatuses !== undefined) {
      sets.push('terminal_statuses = ?::jsonb')
      params.push(terminal)
    }
    if (meta.cancelFromAny !== undefined) {
      sets.push('cancel_from_any = ?')
      params.push(meta.cancelFromAny === true)
    }
    if (meta.cancelStatus !== undefined) {
      sets.push('cancel_status = ?')
      params.push(meta.cancelStatus ?? null)
    }
    if (meta.isDefault !== undefined) {
      sets.push('is_default = ?')
      params.push(meta.isDefault === true)
    }

    if (sets.length > 0) {
      params.push(existing.id)
      await run(`UPDATE project_workflows SET ${sets.join(', ')} WHERE id = ?`, params)
    }
    return get('SELECT * FROM project_workflows WHERE id = ?', [existing.id])
  }

  const created = await run(
    `INSERT INTO project_workflows
       (project_id, name, initial_status, terminal_statuses, cancel_from_any, cancel_status, is_default)
     VALUES (?, ?, ?, ?::jsonb, ?, ?, ?)`,
    [
      projectId,
      meta.name,
      meta.initialStatus ?? null,
      terminal,
      meta.cancelFromAny === true,
      meta.cancelStatus ?? null,
      meta.isDefault === true,
    ],
  )
  return get('SELECT * FROM project_workflows WHERE id = ?', [created.lastID])
}

// POST /api/projects/:projectId/workflow-definitions/apply-template (Admin)
// Seeds the template's states + transitions and creates a default workflow row.
router.post(
  '/projects/:projectId/workflow-definitions/apply-template',
  requireRole('Admin'),
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.projectId)
    const template = getTemplate(req.body?.template || 'qa-lifecycle')
    if (!template) {
      res.status(400).json({ error: `Unknown workflow template "${req.body?.template}"` })
      return
    }

    await ensureStatuses(projectId, template.states)
    await ensureTransitions(projectId, template.transitions)
    const row = await upsertWorkflowMeta(projectId, {
      name: template.name,
      initialStatus: template.initialStatus,
      terminalStatuses: template.terminalStatuses,
      cancelFromAny: template.cancelFromAny,
      cancelStatus: template.cancelStatus,
      isDefault: true,
    })

    res.status(201).json(mapWorkflow(row))
  }),
)

// POST /api/projects/:projectId/workflow-definitions (Admin) — create a custom workflow.
// Optionally seeds provided states + transitions; always creates the metadata row.
router.post(
  '/projects/:projectId/workflow-definitions',
  requireRole('Admin'),
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.projectId)
    const name = String(req.body?.name || '').trim()
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    const states = Array.isArray(req.body?.states) ? req.body.states : []
    const transitions = Array.isArray(req.body?.transitions) ? req.body.transitions : []

    if (states.length > 0) await ensureStatuses(projectId, states)
    if (transitions.length > 0) await ensureTransitions(projectId, transitions)

    // JL-331: pass `undefined` straight through when a key is absent, so
    // upsertWorkflowMeta can tell "not supplied" from "explicitly false".
    // Coercing with `=== true` here turned every omitted flag into false and
    // defeated the partial-update logic downstream — which is how Publish wiped
    // cancel_from_any.
    const boolOrUndefined = (v) => (v === undefined ? undefined : v === true)

    const row = await upsertWorkflowMeta(projectId, {
      name,
      initialStatus: req.body?.initialStatus,
      terminalStatuses: req.body?.terminalStatuses,
      cancelFromAny: boolOrUndefined(req.body?.cancelFromAny),
      cancelStatus: req.body?.cancelStatus,
      isDefault: boolOrUndefined(req.body?.isDefault),
    })
    res.status(201).json(mapWorkflow(row))
  }),
)

// PATCH /api/workflow-definitions/:id (Admin) — edit metadata / set as default.
router.patch('/workflow-definitions/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM project_workflows WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Workflow not found' })
    return
  }

  const sets = []
  const params = []
  if (req.body?.name !== undefined) {
    const name = String(req.body.name || '').trim()
    if (!name) { res.status(400).json({ error: 'name cannot be empty' }); return }
    sets.push('name = ?'); params.push(name)
  }
  if (req.body?.initialStatus !== undefined) { sets.push('initial_status = ?'); params.push(req.body.initialStatus ?? null) }
  if (req.body?.terminalStatuses !== undefined) {
    sets.push('terminal_statuses = ?::jsonb')
    params.push(JSON.stringify(normalizeTerminal(req.body.terminalStatuses)))
  }
  if (req.body?.cancelFromAny !== undefined) { sets.push('cancel_from_any = ?'); params.push(req.body.cancelFromAny === true) }
  if (req.body?.cancelStatus !== undefined) { sets.push('cancel_status = ?'); params.push(req.body.cancelStatus ?? null) }

  if (req.body?.isDefault === true) {
    await run('UPDATE project_workflows SET is_default = FALSE WHERE project_id = ?', [existing.project_id])
    sets.push('is_default = ?'); params.push(true)
  } else if (req.body?.isDefault === false) {
    sets.push('is_default = ?'); params.push(false)
  }

  if (sets.length === 0) { res.json(mapWorkflow(existing)); return }
  params.push(id)
  await run(`UPDATE project_workflows SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get('SELECT * FROM project_workflows WHERE id = ?', [id])
  res.json(mapWorkflow(row))
}))

// DELETE /api/workflow-definitions/:id (Admin)
router.delete('/workflow-definitions/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM project_workflows WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

export default router
