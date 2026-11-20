/*
 * The holding project — where issues go when they have no project.
 *
 * An issue with project_id NULL used to be treated as "legacy, public": the
 * issue list, the per-issue read gates (requireProjectRead lets a project-less
 * target through) and the write gate (plain workspace Member) all let ANY
 * signed-in user read and edit it. Three paths produced such issues:
 *   1. POST /api/issues with no projectId (key PROJ-n),
 *   2. DELETE /api/projects/:id, which set every issue's project_id to NULL —
 *      so deleting a private project published all of its issues,
 *   3. inbound email whose mailbox mapping has no project.
 *
 * Rather than teach a dozen per-route resolvers a special case, project-less
 * issues are removed as a category. Path 1 now requires a project; paths 2 and
 * 3 file the issue here; and a boot-time migration moves the existing orphans
 * here too, keeping their keys. This project has no members and no lead, so the
 * ordinary project gates make its issues visible to workspace Owner/Admin only,
 * who can move them to the right project.
 *
 * Identified by id in workspace_settings, NOT by key: a user project that
 * happened to share the key must never receive orphaned issues.
 */
import { get, run, getSetting, setSetting } from '../db.js'

export const HOLDING_PROJECT_SETTING = 'holding_project_id'
const BASE_KEY = 'ORPHAN'
const NAME = 'Unassigned issues (admins only)'

/** Id of the holding project, creating it if it does not exist yet. */
export async function ensureHoldingProject() {
  const stored = Number(await getSetting(HOLDING_PROJECT_SETTING))
  if (Number.isInteger(stored) && stored > 0) {
    const row = await get('SELECT id FROM projects WHERE id = ?', [stored])
    if (row) return row.id
  }
  // Pick a free key: ORPHAN, ORPHAN2, ORPHAN3 … (PROJECT_KEY_MAX is 10).
  let key = BASE_KEY
  for (let n = 2; await get('SELECT id FROM projects WHERE UPPER(key) = ?', [key]); n++) key = `${BASE_KEY}${n}`
  const created = await run(
    "INSERT INTO projects (name, key, type, lead, lead_member_id) VALUES (?, ?, 'Kanban', 'system', NULL) RETURNING id",
    [NAME, key],
  )
  await setSetting(HOLDING_PROJECT_SETTING, created.lastID)
  return created.lastID
}

/** True when `projectId` is the holding project. */
export async function isHoldingProject(projectId) {
  return Number(await getSetting(HOLDING_PROJECT_SETTING)) === Number(projectId)
}

/**
 * Boot-time migration: move every project-less issue into the holding project.
 * Idempotent — a no-op (and no project is created) when there are none.
 */
export async function adoptProjectlessIssues() {
  const row = await get('SELECT COUNT(*) AS n FROM issues WHERE project_id IS NULL')
  const count = Number(row?.n || 0)
  if (count === 0) return 0
  const holdingId = await ensureHoldingProject()
  const moved = await run('UPDATE issues SET project_id = ? WHERE project_id IS NULL', [holdingId])
  return moved.changes ?? count
}
