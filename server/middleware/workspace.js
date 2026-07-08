import { get } from '../db.js'

/**
 * JL-73: Multi-workspace / tenant context resolution.
 *
 * This is the request-context half of the workspace foundation. It resolves a
 * single `req.workspaceId` for the current request; full per-query row isolation
 * (scoping every SELECT/INSERT by workspace) is an intentional follow-on.
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
 * Middleware: sets `req.workspaceId` from the `X-Workspace-Id` header, falling
 * back to the caller's default workspace membership, then to the seeded default.
 * Must run after authGuard (uses `req.user.email`). Best-effort and non-blocking:
 * on any error it leaves `req.workspaceId` null and continues.
 */
export async function resolveWorkspace(req, _res, next) {
  try {
    const headerVal = req.get?.('X-Workspace-Id') ?? req.headers?.['x-workspace-id'] ?? null

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
    req.workspaceId = pickWorkspaceId(headerVal, userDefault, fallback?.id ?? null)
  } catch {
    req.workspaceId = req.workspaceId ?? null
  }
  next()
}
