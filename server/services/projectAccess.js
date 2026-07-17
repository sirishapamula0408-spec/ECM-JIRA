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

export default loadAccessibleProjectIds
