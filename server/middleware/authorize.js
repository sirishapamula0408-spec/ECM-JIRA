import { get } from '../db.js'

/**
 * Role hierarchy: Owner > Admin > Member > Viewer
 * Higher numeric value = higher privilege.
 */
const ROLE_RANK = {
  Viewer: 1,
  Member: 2,
  Admin: 3,
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
