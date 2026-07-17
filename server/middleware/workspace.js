import { get } from '../db.js'

/**
 * JL-73: Multi-workspace / tenant context resolution.
 * JL-96: Enforce membership on an explicit `X-Workspace-Id` header + scope the
 *        project listing by the resolved workspace.
 *
 * This is the request-context half of the workspace foundation. It resolves a
 * single `req.workspaceId` for the current request.
 *
 * NOTE (follow-on): full per-table row isolation for EVERY domain entity
 * (issues, sprints, comments, attachments, …) is still an intentional
 * follow-on. This ticket (JL-96) closes the header-trust hole — an explicit
 * `X-Workspace-Id` is now verified against `workspace_members` so a user can no
 * longer read another tenant's workspace by spoofing the header — and scopes
 * the project listing. Other domain queries remain workspace-agnostic for now.
 */

export const DEFAULT_WORKSPACE_SLUG = 'default'

/**
 * Pure helper (exported for unit testing).
 *
 * Precedence: explicit `X-Workspace-Id` header > the user's default workspace >
 * the seeded fallback default. Any non-positive-integer candidate is skipped so
 * a malformed header never wins over a valid default.
 *
 * @returns {number|null} the resolved workspace id, or null if none is valid.
 */
export function pickWorkspaceId(headerVal, userDefault, fallbackDefault) {
  const asId = (v) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isInteger(n) && n > 0 ? n : null
  }
  return asId(headerVal) ?? asId(userDefault) ?? asId(fallbackDefault) ?? null
}

/**
 * Membership check helper (exported for unit testing).
 *
 * Returns true when `email` has a row in `workspace_members` for `workspaceId`.
 * Case-insensitive on the email. Returns false for missing args.
 */
export async function isWorkspaceMember(email, workspaceId) {
  if (!email || !workspaceId) return false
  const row = await get(
    `SELECT 1 AS ok FROM workspace_members
     WHERE workspace_id = ? AND LOWER(member_email) = LOWER(?)
     LIMIT 1`,
    [workspaceId, email],
  )
  return !!row
}

/**
 * Middleware: sets `req.workspaceId`.
 *
 * - When an explicit `X-Workspace-Id` header is supplied (JL-96), the caller is
 *   verified against `workspace_members`. A member proceeds with that id; a
 *   non-member is rejected with 403 so the header can no longer be spoofed to
 *   read another tenant's data.
 * - When no header is supplied, we resolve the caller's default workspace, then
 *   the seeded default (JL-73 behavior, unchanged).
 *
 * Resilience: on a legacy/empty install with no `workspace_members` rows at all
 * (single-tenant/dev), the membership gate is skipped so nothing breaks. Any
 * query error leaves `req.workspaceId` untouched and continues (best-effort).
 *
 * Must run after authGuard (uses `req.user.email`).
 */
export async function resolveWorkspace(req, res, next) {
  try {
    const headerVal = req.get?.('X-Workspace-Id') ?? req.headers?.['x-workspace-id'] ?? null
    // Parse the header alone (reuses the pure precedence helper with no defaults).
    const headerId = pickWorkspaceId(headerVal, null, null)

    if (headerId != null) {
      if (await isWorkspaceMember(req.user?.email, headerId)) {
        req.workspaceId = headerId
        return next()
      }
      // Not a member of the explicitly-requested workspace. Only enforce the
      // 403 when membership data actually exists; on a legacy/empty install
      // (no rows anywhere) fall through so single-tenant/dev keeps working.
      const anyMembership = await get(`SELECT 1 AS ok FROM workspace_members LIMIT 1`)
      if (anyMembership) {
        res.status(403).json({ error: 'You are not a member of the requested workspace' })
        return
      }
      req.workspaceId = headerId
      return next()
    }

    // No header → resolve the caller's default workspace, then the seeded default.
    let userDefault = null
    if (req.user?.email) {
      const row = await get(
        `SELECT workspace_id FROM workspace_members
         WHERE LOWER(member_email) = LOWER(?)
         ORDER BY workspace_id ASC LIMIT 1`,
        [req.user.email],
      )
      userDefault = row?.workspace_id ?? null
    }

    const fallback = await get(`SELECT id FROM workspaces WHERE slug = ? LIMIT 1`, [DEFAULT_WORKSPACE_SLUG])
    req.workspaceId = pickWorkspaceId(null, userDefault, fallback?.id ?? null)
    return next()
  } catch {
    req.workspaceId = req.workspaceId ?? null
    return next()
  }
}
