import { get } from '../db.js'

/*
 * JL-473 — resolve a human-readable workspace name for outbound email.
 *
 * The invite email used to say only "join the team on ECM-JIRA", naming the
 * product and never the workspace. Someone who belongs to several workspaces —
 * or who has never heard of the one inviting them — could not tell what they
 * were accepting.
 *
 * Deliberately failure-tolerant. This exists to put a nicer noun in an email;
 * it must never be the reason an invite 500s. Every failure path returns null
 * and the caller falls back to the product name:
 *
 *   - no `workspaces` table (older schema, or a unit-test DB mock that only
 *     stubs the tables its own route touches),
 *   - a member whose workspace_id is null (the common case — POST /api/members
 *     does not set one),
 *   - a workspace row whose name is blank.
 *
 * The no-id branch picks the lowest-id workspace rather than guessing. This app
 * is effectively single-workspace today ("Default Workspace", id 1); when that
 * stops being true the caller should pass a real id, and this fallback becomes
 * the thing that stops being right — which is why it is one query, in one
 * place, and not inlined at the two call sites.
 */
export async function resolveWorkspaceName(workspaceId = null) {
  try {
    if (workspaceId != null && Number.isInteger(Number(workspaceId))) {
      const row = await get('SELECT name FROM workspaces WHERE id = ?', [Number(workspaceId)])
      const name = String(row?.name || '').trim()
      if (name) return name
    }
    const first = await get('SELECT name FROM workspaces ORDER BY id ASC LIMIT 1')
    const name = String(first?.name || '').trim()
    return name || null
  } catch (err) {
    // Not an error worth surfacing — the email still sends, just with the
    // product name in place of the workspace name.
    console.warn(`[workspace] Could not resolve workspace name: ${err.message}`)
    return null
  }
}

export default resolveWorkspaceName
