// JL-329 — one place where a pending invitation is created.
//
// The problem this module exists to remove: there were two independent ways to
// invite someone and they left different traces.
//
//   POST /api/invitations  → an `invitations` row (token + 7-day expiry) + mail
//   POST /api/members      → a `members` row with status='Invited' + audit + mail
//                            and NO `invitations` row at all
//
// So `SELECT count(*) FROM invitations` returning 0 proved nothing, the Teams
// page's pending list (which reads `invitations`) could not see anyone added
// through the second path, resend meant two different things, and only the
// tokened path ever expired.
//
// Both routes now call `issueInvitation()` below, so every pending invite is one
// row in one table with one lifecycle: same token shape, same 7-day TTL, same
// "only the newest pending token for an address is live" rule, and the same
// JL-371 accept flow at the other end.

import crypto from 'node:crypto'
import { all, get, run } from '../db.js'

/** How long a pending invitation stays redeemable. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** Roles an invitation may carry. Owner is tracked via members.is_owner. */
const INVITE_ROLES = ['Admin', 'Member', 'Viewer']

/** The columns every caller returns to the client (never bare `SELECT *`). */
const INVITE_COLUMNS =
  'id, email, role, token, invited_by, status, created_at, expires_at'

/** The same set minus the token — list endpoints must never leak live tokens. */
export const INVITE_LIST_COLUMNS =
  'id, email, role, invited_by, status, created_at, expires_at'

export function newInviteToken() {
  return crypto.randomBytes(32).toString('hex')
}

export function inviteExpiresAt(from = Date.now()) {
  return new Date(from + INVITE_TTL_MS).toISOString()
}

/**
 * Issue a fresh pending invitation for `email`.
 *
 * Revokes any prior pending invitation for the same address first, so exactly
 * one token per address is ever live — the guarantee POST /api/invitations and
 * POST /api/invitations/:id/resend already made, now extended to the members
 * path as well.
 *
 * Returns the stored row (including its token). The `?` placeholders are
 * converted by db.js as usual.
 */
export async function issueInvitation({ email, role = 'Member', invitedBy = 'Team Admin' } = {}) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) throw new Error('issueInvitation requires an email')
  const normalizedRole = INVITE_ROLES.includes(String(role || '').trim())
    ? String(role).trim()
    : 'Member'
  const inviter = String(invitedBy || '').trim() || 'Team Admin'

  await run(
    "UPDATE invitations SET status = 'revoked' WHERE LOWER(email) = LOWER(?) AND status = 'pending'",
    [normalized],
  )

  const token = newInviteToken()
  const expiresAt = inviteExpiresAt()
  const created = await run(
    'INSERT INTO invitations (email, role, token, invited_by, status, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [normalized, normalizedRole, token, inviter, 'pending', expiresAt],
  )

  const stored = await get(
    `SELECT ${INVITE_COLUMNS} FROM invitations WHERE id = ?`,
    [created?.lastID],
  )

  // Fall back to the values we just wrote if the read-back is unavailable, so a
  // caller always gets a usable token rather than `undefined`.
  return (
    stored || {
      id: created?.lastID ?? null,
      email: normalized,
      role: normalizedRole,
      token,
      invited_by: inviter,
      status: 'pending',
      created_at: null,
      expires_at: expiresAt,
    }
  )
}

/**
 * The canonical "who has a pending invitation?" query.
 *
 * One table, one predicate. Exported so the answer is defined in exactly one
 * place — GET /api/invitations?status=pending is this, and nothing else needs
 * to union `members` to find invitees any more.
 *
 * `includeExpired` defaults to true because a pending-but-expired invitation is
 * still an outstanding invitation the admin has to deal with (the list badges
 * it and offers a resend — JL-251).
 */
export async function listPendingInvitations({ includeExpired = true } = {}) {
  const sql = includeExpired
    ? `SELECT ${INVITE_LIST_COLUMNS} FROM invitations WHERE status = 'pending' ORDER BY id DESC`
    : `SELECT ${INVITE_LIST_COLUMNS} FROM invitations WHERE status = 'pending' AND expires_at > NOW() ORDER BY id DESC`
  return all(sql)
}

/**
 * JL-329 reconciliation — adopt the rows the old members path left behind.
 *
 * Before this ticket, `POST /api/members` wrote `members.status = 'Invited'` and
 * nothing else. Those people are genuinely pending but have no invitation row,
 * so after the convergence they would be the only invites still invisible in the
 * canonical list — exactly the orphaning the ticket forbids. This backfills one
 * invitation row per such member.
 *
 * The backfilled row is deliberately created ALREADY EXPIRED
 * (`expires_at` = now - 1s), not with a fresh 7-day TTL:
 *
 *   - `members` carries no created_at, so we cannot know whether the invite is
 *     a day or a year old. Minting a live 7-day token would silently re-open
 *     invitations that lapsed long ago, and under the `invite_only` signup
 *     policy (JL-369) an unexpired invitation authorises registration — so a
 *     fresh TTL would hand stale addresses a live signup right nobody granted.
 *   - Expired-pending is the honest state and it is not a dead end: the list
 *     badges it `expired` and the Resend button re-issues a real 7-day token
 *     (JL-251), which is the same recovery path any genuinely lapsed invite
 *     already uses. The invite is visible and actionable, just not silently
 *     revalidated.
 *
 * Idempotent: it only touches members that have NO invitation row for their
 * address in any status, so a second boot (or a subsequently revoked row) is a
 * no-op. Safe to run on every startup.
 */
export async function reconcileInvitedMembers({ now = Date.now() } = {}) {
  const orphans = await all(
    `SELECT m.id, m.email, m.role, m.invited_by
       FROM members m
      WHERE m.status = 'Invited'
        AND NOT EXISTS (
          SELECT 1 FROM invitations i WHERE LOWER(i.email) = LOWER(m.email)
        )
      ORDER BY m.id ASC`,
  )

  const expiresAt = new Date(now - 1000).toISOString()
  const created = []

  for (const member of orphans || []) {
    const email = String(member?.email || '').trim().toLowerCase()
    if (!email) continue
    const role = INVITE_ROLES.includes(String(member?.role || '').trim())
      ? String(member.role).trim()
      : 'Member'
    try {
      // ON CONFLICT DO NOTHING keeps a concurrent boot (or a token collision)
      // from failing the whole migration. The explicit RETURNING id is required
      // because db.js's run() would otherwise append its own.
      await run(
        `INSERT INTO invitations (email, role, token, invited_by, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [email, role, newInviteToken(), member?.invited_by || 'Team Admin', 'pending', expiresAt],
      )
      created.push(email)
    } catch (err) {
      console.error(`[invitations] Could not reconcile invited member ${email}: ${err.message}`)
    }
  }

  if (created.length > 0) {
    console.log(
      `[invitations] JL-329 reconciliation: adopted ${created.length} status='Invited' member(s) with no invitation row`,
    )
  }
  return { examined: (orphans || []).length, created }
}
