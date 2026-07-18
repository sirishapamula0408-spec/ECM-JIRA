import { get } from '../db.js'

/**
 * Role hierarchy: Owner > Admin > Member > Viewer (workspace),
 * with the project-level "Lead" role as the highest project tier
 * (ranked at/above Admin so a project Lead has full project-admin rights).
 * Higher numeric value = higher privilege.
 */
export const ROLE_RANK = {
  Viewer: 1,
  Member: 2,
  Admin: 3,
  Lead: 4,
}

/**
 * Middleware: loads the current user's workspace role from the members table.
 * Must run after authGuard (requires req.user.email).
 *
 * Sets on req.user:
 *   - memberId: number | null
 *   - workspaceRole: 'Admin' | 'Member' | 'Viewer'
 *   - isOwner: boolean
 */
export async function loadUserRoles(req, res, next) {
  try {
    const member = await get(
      'SELECT id, role, is_owner FROM members WHERE LOWER(email) = LOWER(?)',
      [req.user.email],
    )
    req.user.memberId = member?.id || null
    req.user.workspaceRole = member?.role || 'Viewer'
    req.user.isOwner = Boolean(member?.is_owner)
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Factory: returns middleware that checks the user's workspace role
 * against a list of allowed roles.
 *
 * Owner always passes. Roles are checked by hierarchy:
 * if the user's role rank >= the minimum required rank, they pass.
 *
 * Usage: requireRole('Admin')           — Admin and Owner only
 *        requireRole('Member', 'Admin') — Member, Admin, and Owner
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    // Owner always bypasses
    if (req.user.isOwner) return next()

    const userRank = ROLE_RANK[req.user.workspaceRole] || 0
    const minRank = Math.min(...allowedRoles.map((r) => ROLE_RANK[r] || 0))

    if (userRank >= minRank) return next()

    res.status(403).json({ error: 'Insufficient permissions' })
  }
}

/**
 * Middleware: loads the user's project-level role for the current project.
 * Extracts projectId from req.params.id, req.params.projectId, or req.body.projectId.
 *
 * Sets on req.user:
 *   - projectRole: 'Admin' | 'Member' | 'Viewer' | null
 */
export async function loadProjectRole(req, res, next) {
  try {
    const projectId = req.params.id || req.params.projectId || req.body?.projectId
    if (!projectId || !req.user.memberId) {
      req.user.projectRole = null
      return next()
    }

    const row = await get(
      'SELECT role FROM project_members WHERE project_id = ? AND member_id = ?',
      [projectId, req.user.memberId],
    )
    req.user.projectRole = row?.role || null
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Factory: returns middleware that checks the user's project-level role.
 * Workspace Admin and Owner always bypass project-level checks.
 *
 * Usage: requireProjectRole('Admin')           — project Admin only
 *        requireProjectRole('Member', 'Admin') — project Member or Admin
 */
export function requireProjectRole(...allowedRoles) {
  return (req, res, next) => {
    // Workspace Admin/Owner bypass project-level checks
    if (req.user.isOwner || req.user.workspaceRole === 'Admin') return next()

    if (!req.user.projectRole) {
      return res.status(403).json({ error: 'Insufficient project permissions' })
    }

    const userRank = ROLE_RANK[req.user.projectRole] || 0
    const minRank = Math.min(...allowedRoles.map((r) => ROLE_RANK[r] || 0))

    if (userRank >= minRank) return next()

    res.status(403).json({ error: 'Insufficient project permissions' })
  }
}

/**
 * JL-224/225/226: reusable project-scoped access resolution.
 *
 * Target model: workspace Owner/Admin can access ALL projects; every other user
 * (workspace Member/Viewer) may only access projects they explicitly belong to
 * — an explicit `project_members` row (any project role) or being the project
 * lead (`projects.lead_member_id`).
 *
 * Returns a descriptor:
 *   - admin        : workspace Owner/Admin (bypasses all project checks)
 *   - projectExists: whether the target project row exists (false also when no
 *                    project id was resolvable — e.g. a project-less issue)
 *   - hasAccess    : the (non-admin) caller has read access to the project
 *   - projectRole  : the caller's project role ('Lead'|'Admin'|'Member'|'Viewer'|null)
 *   - effectiveRank : max(workspace rank, project rank) — mirrors
 *                     src/hooks/usePermissions.js so a workspace Viewer who holds
 *                     a project Member/Admin role is treated by that higher role.
 */
export async function resolveProjectAccess(user, projectId) {
  const wsRank = ROLE_RANK[user?.workspaceRole] || 0

  if (user?.isOwner || user?.workspaceRole === 'Admin') {
    return { admin: true, projectExists: true, hasAccess: true, projectRole: null, effectiveRank: ROLE_RANK.Admin }
  }

  if (projectId == null) {
    return { admin: false, projectExists: false, hasAccess: false, projectRole: null, effectiveRank: wsRank }
  }

  const row = await get(
    `SELECT p.id, p.lead_member_id, pm.role AS project_role
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.member_id = ?
      WHERE p.id = ?`,
    [user?.memberId ?? null, projectId],
  )

  if (!row) {
    return { admin: false, projectExists: false, hasAccess: false, projectRole: null, effectiveRank: wsRank }
  }

  const isLead =
    row.lead_member_id != null && Number(row.lead_member_id) === Number(user?.memberId)
  const projectRole = row.project_role || (isLead ? 'Lead' : null)
  const projRank = ROLE_RANK[projectRole] || 0

  return {
    admin: false,
    projectExists: true,
    hasAccess: Boolean(projectRole),
    projectRole,
    effectiveRank: Math.max(wsRank, projRank),
  }
}

/**
 * JL-225: convenience predicate — may this user READ the given project's data?
 * True for workspace Owner/Admin, or any project member/lead.
 */
export async function canAccessProject(user, projectId) {
  const access = await resolveProjectAccess(user, projectId)
  return access.admin || access.hasAccess
}

/**
 * JL-225: read-gating middleware factory.
 *
 * `resolveId(req)` returns (or resolves to) the target project id — for issue
 * routes this is the issue's `project_id` (loaded from the DB); for project
 * routes it is the path param. Workspace Owner/Admin bypass. A project that does
 * not exist (or a project-less target) is allowed through so the handler can
 * return its own 404 / legacy public response. Everyone else must have access.
 */
export function requireProjectRead(resolveId) {
  return async (req, res, next) => {
    try {
      // Fast path: workspace Admin/Owner bypass without any project lookup, so
      // Admin-stubbed route tests keep their exact db-call sequence.
      if (req.user?.isOwner || req.user?.workspaceRole === 'Admin') return next()

      const projectId = await resolveId(req)
      const access = await resolveProjectAccess(req.user, projectId)
      if (!access.projectExists || access.hasAccess) return next()

      res.status(403).json({ error: 'You do not have access to this project' })
    } catch (err) {
      next(err)
    }
  }
}

/**
 * JL-226: write-gating middleware factory.
 *
 * Requires the caller to have PROJECT access (a project_members row / lead) AND
 * an effective role of at least Member — mirroring usePermissions. Workspace
 * Owner/Admin bypass. When no project is resolvable (project-less issue or a
 * create without a projectId) the legacy workspace-role gate (Member+) applies,
 * preserving backward-compatible behavior for project-less data.
 */
export function requireProjectWrite(resolveId) {
  return async (req, res, next) => {
    try {
      // Fast path: workspace Admin/Owner bypass without any project lookup.
      if (req.user?.isOwner || req.user?.workspaceRole === 'Admin') return next()

      const projectId = await resolveId(req)
      const access = await resolveProjectAccess(req.user, projectId)

      if (!access.projectExists) {
        // No resolvable project — fall back to the legacy workspace-role gate.
        if (access.effectiveRank >= ROLE_RANK.Member) return next()
        return res.status(403).json({ error: 'Insufficient permissions' })
      }

      if (access.hasAccess && access.effectiveRank >= ROLE_RANK.Member) return next()

      res.status(403).json({ error: 'Insufficient project permissions' })
    } catch (err) {
      next(err)
    }
  }
}
