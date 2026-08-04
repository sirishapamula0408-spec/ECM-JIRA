// JL-187 — shared "which projects can this caller see?" resolver.
//
// Extracted so tenant-scoped analytics endpoints (report builder, portfolio,
// BI export, …) all apply the SAME accessibility rule as the projects listing
// (projects.js GET /) instead of each re-implementing it (or, worse, skipping
// it and leaking cross-tenant data — the JL-173 report-builder bug).
//
// A project is accessible when the caller is a project member OR the project
// lead, optionally constrained to the resolved workspace. Legacy NULL-workspace
// rows stay visible so single-tenant / pre-migration installs are unaffected.

import { all, get } from '../db.js'

/**
 * Resolve the list of project ids the given user may access.
 *
 * @param {{ email?: string }} user            typically req.user
 * @param {number|null} [workspaceId]           typically req.workspaceId ?? null
 * @returns {Promise<number[]>} accessible project ids (empty when none / no user)
 */
export async function loadAccessibleProjectIds(user, workspaceId = null) {
  const userEmail = user?.email
  if (!userEmail) return []

  const member = await get('SELECT id, name FROM members WHERE LOWER(email) = LOWER(?)', [userEmail])

  let rows
  if (member) {
    const params = [member.id, member.name]
    const wsClause = workspaceId != null ? ' AND (p.workspace_id = ? OR p.workspace_id IS NULL)' : ''
    if (workspaceId != null) params.push(workspaceId)
    rows = await all(
      `SELECT DISTINCT p.id FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.member_id = ?
       WHERE (pm.member_id IS NOT NULL OR LOWER(p.lead) = LOWER(?))${wsClause}`,
      params,
    )
  } else {
    const leadClause = workspaceId != null ? ' AND (workspace_id = ? OR workspace_id IS NULL)' : ''
    const params = [userEmail]
    if (workspaceId != null) params.push(workspaceId)
    rows = await all(`SELECT id FROM projects WHERE LOWER(lead) = LOWER(?)${leadClause}`, params)
  }

  return (rows || []).map((r) => Number(r.id))
}

/**
 * Request-level variant of the above: resolves the project ids in scope for the
 * CALLER, granting a workspace Owner/Admin every project in their own workspace
 * (they legitimately see the whole tenant) and everyone else the projects they
 * are a member of / lead.
 *
 * JL-362: lifted out of dashboardGadgets.js (where JL-356 introduced it) so the
 * activity feed applies exactly the same rule. The SQL is unchanged.
 *
 * @param {{ workspaceId?: number|null, user?: object }} req
 * @returns {Promise<number[]>}
 */
export async function loadScopeProjectIds(req) {
  const workspaceId = req?.workspaceId ?? null
  const isWorkspaceAdmin = req?.user?.isOwner || req?.user?.workspaceRole === 'Admin'
  if (isWorkspaceAdmin) {
    // Legacy NULL-workspace rows stay visible so single-tenant / pre-migration
    // installs are unaffected (mirrors the wsClause in projects.js).
    const scoped = workspaceId != null
    const rows = await all(
      `SELECT id FROM projects${scoped ? ' WHERE workspace_id = ? OR workspace_id IS NULL' : ''}`,
      scoped ? [workspaceId] : [],
    )
    return (rows || []).map((r) => Number(r.id))
  }
  return loadAccessibleProjectIds(req?.user, workspaceId)
}

export default loadAccessibleProjectIds
