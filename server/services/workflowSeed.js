// JL-334 — every project gets a default workflow.
//
// Previously `POST /api/projects` inserted into `projects` alone: no statuses,
// no transitions, no project_workflows row. A new project therefore rendered the
// GLOBAL statuses via the issueConfig fallback and showed "No default workflow",
// and nothing configured one until an admin happened to open the Workflow Editor
// and press Apply. 3 of 5 existing projects were in that state.
//
// This module owns seeding so both the create path and the boot-time backfill
// use one implementation.

import { all, get, run } from '../db.js'
import { QA_LIFECYCLE } from './workflowTemplates.js'

/**
 * Give `projectId` the default workflow template if it has none.
 *
 * Idempotent and additive:
 *  - statuses already present (by name, case-insensitive) are left alone, so a
 *    project that already has its own set keeps it and merely gains anything
 *    the template adds;
 *  - transitions are skipped if an identical pair already exists;
 *  - if the project already has ANY project_workflows row, nothing happens —
 *    we never overwrite a workflow someone configured.
 *
 * Returns { seeded, statuses, transitions }.
 */
export async function seedDefaultWorkflow(projectId, template = QA_LIFECYCLE) {
  const existingWorkflow = await get(
    'SELECT id FROM project_workflows WHERE project_id = ? LIMIT 1',
    [projectId],
  )
  if (existingWorkflow) return { seeded: false, statuses: 0, transitions: 0 }

  // --- statuses (additive; never removes what the project already shows) ---
  const own = await all(
    'SELECT LOWER(name) AS lname FROM issue_statuses WHERE project_id = ?',
    [projectId],
  )
  const have = new Set(own.map((r) => r.lname))

  // A project with no rows of its own is currently displaying the globals, so
  // copy those down first — otherwise seeding would make them vanish (JL-332).
  if (own.length === 0) {
    const globals = await all(
      'SELECT name, position, color, category FROM issue_statuses WHERE project_id IS NULL ORDER BY position ASC, name ASC',
      [],
    )
    for (const g of globals) {
      await run(
        'INSERT INTO issue_statuses (project_id, name, position, color, category) VALUES (?, ?, ?, ?, ?)',
        [projectId, g.name, g.position, g.color, g.category],
      )
      have.add(String(g.name).toLowerCase())
    }
  }

  let position = have.size
  let statusesAdded = 0
  for (const state of template.states) {
    if (have.has(state.name.toLowerCase())) continue
    await run(
      'INSERT INTO issue_statuses (project_id, name, position, color, category) VALUES (?, ?, ?, ?, ?)',
      [projectId, state.name, position, state.color, state.category],
    )
    have.add(state.name.toLowerCase())
    position += 1
    statusesAdded += 1
  }

  // --- transitions ---
  let transitionsAdded = 0
  for (const [fromStatus, toStatus] of template.transitions) {
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
    transitionsAdded += 1
  }

  // --- the workflow row itself ---
  await run(
    `INSERT INTO project_workflows
       (project_id, name, initial_status, terminal_statuses, cancel_from_any, cancel_status, is_default)
     VALUES (?, ?, ?, ?::jsonb, ?, ?, TRUE)`,
    [
      projectId,
      template.name,
      template.initialStatus,
      JSON.stringify(template.terminalStatuses || []),
      template.cancelFromAny === true,
      template.cancelStatus ?? null,
    ],
  )

  return { seeded: true, statuses: statusesAdded, transitions: transitionsAdded }
}

/**
 * Backfill every project that has no workflow at all. Safe to run on every boot:
 * projects that already have one are skipped by seedDefaultWorkflow.
 */
export async function backfillDefaultWorkflows() {
  const projects = await all(
    `SELECT p.id FROM projects p
      WHERE NOT EXISTS (SELECT 1 FROM project_workflows w WHERE w.project_id = p.id)
      ORDER BY p.id ASC`,
    [],
  )
  let seeded = 0
  for (const p of projects) {
    try {
      const result = await seedDefaultWorkflow(p.id)
      if (result.seeded) seeded += 1
    } catch (err) {
      // A single bad project must not stop the server booting.
      console.error(`[workflowSeed] Could not seed project ${p.id}: ${err.message}`)
    }
  }
  if (seeded > 0) {
    console.log(`[workflowSeed] Seeded a default workflow for ${seeded} project(s)`)
  }
  return seeded
}
