// JL-362 — tenant scoping for reads of the `activity` table.
//
// THE BUG
// -------
// `GET /api/activity` selected straight out of `activity` with no tenant
// predicate at all, so any authenticated user could page through the entire
// feed — every workspace's issue keys, titles, status transitions and member
// management events. `GET /api/dashboard` had the same unscoped read, and
// JL-356 had to bolt a partial clause onto the recent_activity gadget precisely
// because this endpoint was leaking underneath it.
//
// THE COMPLICATION
// ----------------
// Before this ticket NO writer set `activity.project_id` — all five insert
// sites (three in issues.js, one in members.js, one in seed.js) inserted
// `(actor, action, happened_at)` only. So 100% of rows had `project_id IS NULL`
// and a naive `project_id IN (...)` filter would have emptied the feed rather
// than secured it. Nor could those rows be attributed via the actor: `actor` is
// a free-text assignee/display name ('Sarah Johnson', 'System', an email), and
// `members.workspace_id` is not a reliable tenant marker either — no member
// insert sets it and db.js backfills every NULL to the DEFAULT workspace on
// boot, so a member of workspace B ends up labelled workspace A.
//
// THE FIX
// -------
// Attribution is now written at insert time instead of being guessed at read
// time: the issues.js inserts carry `project_id`/`issue_id`, the members.js
// insert carries `workspace_id`, and db.js backfills historical rows by pulling
// the issue key out of the `action` text. Reads then apply this rule:
//
//   1. project_id IS NOT NULL  → visible iff the project is in the caller's
//                                accessible set (loadScopeProjectIds).
//   2. project_id IS NULL and
//      workspace_id IS NOT NULL → visible iff it is the caller's workspace
//                                (workspace-level events such as member
//                                add/remove/role-change belong to a tenant but
//                                to no project).
//   3. project_id IS NULL and
//      workspace_id IS NULL     → UNATTRIBUTABLE. Hidden, unless the install
//                                has at most one workspace.
//
// Rule 3 is the deliberate trade-off. These are legacy rows that the backfill
// could not resolve (no issue key in the action text, or an issue that has since
// been deleted) plus anything a future writer forgets to attribute. They cannot
// be tied to a tenant by any column we have, so the safe choice is to hide them
// — this reverses JL-356's interim decision to keep them visible, which was
// correct for that ticket's scope but is exactly the hole JL-362 has to close.
// The single-workspace carve-out is provably free of cross-tenant risk: with
// zero or one workspace there is no other tenant to leak to, and it keeps
// dev/demo/single-tenant installs from losing their feed to this change.

import { get } from '../db.js'
import { loadScopeProjectIds } from './projectAccess.js'

/**
 * True when the install cannot possibly leak across tenants because it has at
 * most one workspace. Errors (e.g. a pre-JL-73 install with no `workspaces`
 * table) resolve to true for the same reason: no workspaces, no multi-tenancy.
 */
export async function isSingleTenantInstall() {
  try {
    const row = await get('SELECT COUNT(*) AS count FROM workspaces')
    return Number(row?.count ?? 0) <= 1
  } catch {
    return true
  }
}

/**
 * Build the tenant-scoping WHERE fragment for a query over `activity`.
 *
 * Returned clauses/params are deterministic for a given request, so they are
 * identical on every page of a cursor-paginated scan — a filter that varied
 * between pages would silently corrupt the `nextCursor` walk (JL-44).
 *
 * @param {{ workspaceId?: number|null, user?: object }} req
 * @returns {Promise<{ clause: string, params: any[] }>}
 */
export async function buildActivityScope(req) {
  const workspaceId = req?.workspaceId ?? null
  const projectIds = await loadScopeProjectIds(req)

  const branches = []
  const params = []

  // Rule 1 — rows attributed to a project the caller can reach.
  if (projectIds.length > 0) {
    branches.push(`(project_id IS NOT NULL AND project_id IN (${projectIds.map(() => '?').join(', ')}))`)
    params.push(...projectIds)
  }

  // Rule 2 — workspace-level rows (member management) for the caller's tenant.
  if (workspaceId != null) {
    branches.push('(project_id IS NULL AND workspace_id = ?)')
    params.push(workspaceId)
  }

  // Rule 3 — unattributable rows, only on an install with no other tenant.
  if (await isSingleTenantInstall()) {
    branches.push('(project_id IS NULL AND workspace_id IS NULL)')
  }

  // No branch at all means the caller can reach nothing: fail closed rather
  // than degrading to "no WHERE clause", which is how this leaked originally.
  return { clause: branches.length > 0 ? `(${branches.join(' OR ')})` : 'FALSE', params }
}

/**
 * Convenience wrapper for callers that just need `... FROM activity <where>`.
 * @returns {Promise<{ where: string, params: any[] }>}
 */
export async function activityScopeWhere(req) {
  const { clause, params } = await buildActivityScope(req)
  return { where: ` WHERE ${clause}`, params }
}

export default buildActivityScope
