/*
 * JL-489 — the "Release" status and release verification.
 *
 * A work item that has passed testing moves to Release. Once its release is
 * marked Released, the project's Release Monitor confirms it in the released
 * build:
 *   Pass -> Done
 *   Fail -> back to the status it came from (with a reason)
 *
 * Scope: a project is "monitored" while it has an Active member holding the
 * Release Monitor project role. Only a monitored project gets the Release
 * status, and only there must Done be reached through Release. Projects without
 * a monitor behave exactly as before.
 *
 * Who may move a work item OUT of Release: the Release Monitor (through the
 * verdict endpoint), project Lead/Admin and workspace Admin/Owner. A project
 * Member moves work INTO Release but can never mark their own work Done.
 */
import { all, get, run } from '../db.js'
import { ROLE_RANK } from '../middleware/authorize.js'
import { RELEASE_MONITOR_ROLE } from './releaseCheck.js'

export const RELEASE_STATUS = 'Release'
export const DONE = 'Done'
// Where a failed item goes when its history does not say where it came from.
export const FAIL_FALLBACK_STATUS = 'In Progress'
const RELEASE_STATUS_COLOR = '#E6FCFF' // Atlassian teal surface (T50)

export async function isMonitoredProject(projectId) {
  if (!projectId) return false
  const row = await get(
    `SELECT 1 FROM project_members pm JOIN members m ON m.id = pm.member_id
      WHERE pm.project_id = ? AND pm.role = ? AND m.status = 'Active' LIMIT 1`,
    [projectId, RELEASE_MONITOR_ROLE],
  )
  return Boolean(row)
}

/**
 * May this user give a Pass/Fail verdict (or otherwise move an item out of
 * Release)? `access` is resolveProjectAccess() for the item's project.
 */
export function canVerifyRelease(access) {
  if (!access) return false
  if (access.admin) return true
  if (access.projectRole === RELEASE_MONITOR_ROLE) return true
  return (access.effectiveRank || 0) >= ROLE_RANK.Admin
}

// Releases the item belongs to: the single release field or a Fix Version.
export async function issueReleases(issueId) {
  return all(
    `SELECT r.id, r.name, r.status FROM releases r
      WHERE r.id IN (SELECT release_id FROM issues WHERE id = ?)
         OR r.id IN (SELECT version_id FROM issue_versions WHERE issue_id = ? AND type = 'fix')
      ORDER BY r.id ASC`,
    [issueId, issueId],
  )
}

// The status an item had just before it last entered Release.
export async function previousStatusBeforeRelease(issueId) {
  const row = await get(
    `SELECT old_value FROM issue_history
      WHERE issue_id = ? AND field = 'status' AND new_value = ? AND old_value IS NOT NULL AND old_value <> ?
      ORDER BY changed_at DESC, id DESC LIMIT 1`,
    [issueId, RELEASE_STATUS, RELEASE_STATUS],
  )
  return row?.old_value || FAIL_FALLBACK_STATUS
}

/**
 * The Release rules, checked before the workflow. Returns null when they have
 * nothing to say, a refusal { httpStatus, error }, or { skipWorkflow: true }
 * for a verdict (Pass/Fail is its own governed step: "back to the previous
 * status" has no workflow edge, and must not need one).
 *
 * ctx.user    the acting user (undefined for internal callers: no role gate)
 * ctx.access  resolveProjectAccess() result, when already known
 * ctx.releaseVerdict  set ONLY by the verdict endpoint, never from a request body
 */
export async function releaseGate(existing, status, ctx = {}, resolveAccess) {
  if (!existing || existing.status === status) return null
  const leavingRelease = existing.status === RELEASE_STATUS

  if (leavingRelease) {
    if (!ctx.releaseVerdict && ctx.user) {
      const access = ctx.access || (resolveAccess ? await resolveAccess(ctx.user, existing.project_id) : null)
      // The generic status change is for Lead/Admin only; the Release Monitor
      // uses the verdict endpoint (they have no general write access).
      if (!access || !(access.admin || (access.effectiveRank || 0) >= ROLE_RANK.Admin)) {
        return { httpStatus: 403, error: 'Only the Release Monitor or a project Lead/Admin can move a work item out of Release' }
      }
    }
    if (status === DONE) {
      const releases = await issueReleases(existing.id)
      if (!releases.some((r) => r.status === 'released')) {
        return { httpStatus: 409, error: 'Its release is not marked Released yet, so it cannot be verified' }
      }
    }
    return ctx.releaseVerdict ? { skipWorkflow: true } : null
  }

  if (status === RELEASE_STATUS) {
    const releases = await issueReleases(existing.id)
    if (releases.length === 0) {
      return { httpStatus: 400, error: 'Set a Fix Version before moving this work item to Release' }
    }
    return null
  }

  if (status === DONE && await isMonitoredProject(existing.project_id)) {
    return {
      httpStatus: 409,
      error: 'This project verifies releases: move the work item to Release, and the Release Monitor moves it to Done',
    }
  }
  return null
}

/**
 * Give a project the Release status (before Done) and its workflow edges:
 * every X -> Done gets an X -> Release twin, plus Release -> Done. Existing
 * edges are left alone (non-destructive: removing the monitor lifts the rule).
 * Idempotent.
 */
export async function ensureReleaseStatus(projectId) {
  if (!projectId) return false
  let statuses = await all('SELECT id, name, position FROM issue_statuses WHERE project_id = ? ORDER BY position ASC, id ASC', [projectId])
  if (statuses.length === 0) {
    // The project used the global list; give it its own copy so adding Release
    // here does not add it to every project.
    const global = await all('SELECT name, position, color, category FROM issue_statuses WHERE project_id IS NULL ORDER BY position ASC, id ASC', [])
    for (const s of global) {
      await run('INSERT INTO issue_statuses (project_id, name, position, color, category) VALUES (?, ?, ?, ?, ?)', [projectId, s.name, s.position, s.color, s.category])
    }
    statuses = await all('SELECT id, name, position FROM issue_statuses WHERE project_id = ? ORDER BY position ASC, id ASC', [projectId])
  }
  const transitions = await all('SELECT from_status, to_status FROM workflow_transitions WHERE project_id = ?', [projectId])
  let changed = false
  if (!statuses.some((s) => s.name === RELEASE_STATUS)) {
    // Right after the last status that leads into Done (e.g. In UAT), so the
    // board reads "... In UAT, Release ...". Done is not a reliable anchor: a
    // new project lists it before the QA statuses. No workflow -> before Done.
    const feeders = new Set(transitions.filter((r) => r.to_status === DONE).map((r) => r.from_status))
    const lastFeeder = statuses.filter((s) => feeders.has(s.name)).at(-1)
    const done = statuses.find((s) => s.name === DONE)
    const position = lastFeeder ? lastFeeder.position + 1 : done ? done.position : (statuses.at(-1)?.position ?? -1) + 1
    await run('UPDATE issue_statuses SET position = position + 1 WHERE project_id = ? AND position >= ?', [projectId, position])
    await run(
      "INSERT INTO issue_statuses (project_id, name, position, color, category) VALUES (?, ?, ?, ?, 'inprogress')",
      [projectId, RELEASE_STATUS, position, RELEASE_STATUS_COLOR],
    )
    changed = true
  }

  if (transitions.length > 0) {
    const has = (f, t) => transitions.some((r) => r.from_status === f && r.to_status === t)
    const intoDone = [...new Set(transitions.filter((r) => r.to_status === DONE && r.from_status !== RELEASE_STATUS).map((r) => r.from_status))]
    const add = [...intoDone.filter((f) => !has(f, RELEASE_STATUS)).map((f) => [f, RELEASE_STATUS])]
    if (!has(RELEASE_STATUS, DONE)) add.push([RELEASE_STATUS, DONE])
    for (const [f, t] of add) {
      await run('INSERT INTO workflow_transitions (project_id, from_status, to_status) VALUES (?, ?, ?)', [projectId, f, t])
      changed = true
    }
  }
  return changed
}

// Boot: every project that already has a Release Monitor gets the status.
export async function ensureReleaseStatusForMonitoredProjects() {
  const rows = await all(
    `SELECT DISTINCT pm.project_id FROM project_members pm JOIN members m ON m.id = pm.member_id
      WHERE pm.role = ? AND m.status = 'Active'`,
    [RELEASE_MONITOR_ROLE],
  )
  for (const { project_id: pid } of rows) await ensureReleaseStatus(pid)
  return rows.length
}
