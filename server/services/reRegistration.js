// JL-155 — signing up with an address that already has a login (`users` row).
//
// Removing a member never deletes their `users` row (JL-325 deactivates it so
// authored content keeps its attribution), so once an admin re-admits the
// address the old row still answered every signup with 409 "already
// registered". This module decides what that leftover row means:
//
//   none        no login for this address — create one as normal
//   active      a live account — refuse, point at log in / reset password
//   refused     deliberately shut: suspended by an admin (member row still
//               present and Deactivated) or deprovisioned by SCIM. Signing up
//               must not undo either, so it is refused as "not eligible"
//   replace     never really used: no authored content and nothing hanging
//               off it — hard-delete and create a fresh login
//   reactivate  was used: content or account links reference it — keep the
//               row (and its id), attach the new password, mark it Active
//
// The deny-list and invite policy (signupPolicy.js) run BEFORE this, so a
// removed address only reaches here after an admin has re-admitted it, and an
// address with no record at all gets no special pass.
//
// Authored content in this schema references people by email TEXT, not by
// foreign key, so "has dependent rows" cannot be answered by the database's
// constraints. AUTHORED_REFERENCES lists the columns that count. Matching is by
// email only: several of these columns sometimes hold a display name instead,
// and names collide, so a name match could not safely gate a hard delete.

import { all } from '../db.js'

/** User-facing signup errors. Deliberately two, and deliberately vague: the
 *  "exists" answer reveals no more than the 409 signup has always returned,
 *  and every other refusal (removed, suspended, not invited, deprovisioned)
 *  reads the same, so the message cannot be used to learn which applies. */
export const SIGNUP_ERRORS = {
  accountExists:
    'An account already exists for this email address. Log in, or reset your password if you have forgotten it.',
  notEligible:
    'This email address is not eligible to register here. Contact your workspace admin.',
}

/** Columns whose rows mean the login was used. `where` narrows a column that
 *  also records events the person did not author. */
export const AUTHORED_REFERENCES = [
  { table: 'issues', column: 'reporter' },
  { table: 'issue_history', column: 'actor' },
  { table: 'comments', column: 'author' },
  { table: 'comment_reactions', column: 'user_email' },
  { table: 'worklogs', column: 'author' },
  { table: 'attachments', column: 'uploaded_by' },
  { table: 'approvals', column: 'approver_email' },
  { table: 'activity', column: 'actor' },
  { table: 'filters', column: 'owner_email' },
  { table: 'shared_dashboards', column: 'owner_email' },
  { table: 'spaces', column: 'created_by' },
  { table: 'wiki_pages', column: 'created_by' },
  { table: 'wiki_pages', column: 'updated_by' },
  { table: 'wiki_page_comments', column: 'author' },
  { table: 'wiki_page_attachments', column: 'uploaded_by' },
  { table: 'documents', column: 'uploaded_by' },
  { table: 'document_versions', column: 'uploaded_by' },
  { table: 'document_folders', column: 'created_by' },
  { table: 'kb_articles', column: 'author_email' },
  { table: 'api_tokens', column: 'user_email' },
  // A failed login is something done TO the address, not by its owner.
  { table: 'audit_log', column: 'actor', where: "action <> 'auth.login.failed'" },
  { table: 'user_audit_log', column: 'actor', where: "action NOT IN ('login_blocked', 'signup_rejected')" },
]

/** Rows that point at users.id and would CASCADE away on a hard delete. A
 *  linked SSO identity or SCIM group membership means the login is real. */
const USER_ID_REFERENCES = [
  { table: 'oauth_identities', column: 'user_id' },
  { table: 'scim_group_members', column: 'user_id' },
]

/** Which of the referenced tables/columns exist in the current schema.
 *  current_schema() rather than 'public', so isolated test schemas work. */
async function existingColumns(db) {
  const rows = await db.all(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()`,
  )
  return new Set(rows.map((r) => `${r.table_name}.${r.column_name}`))
}

/** Every reference to this login, as [{ table, column, count }]. Empty means
 *  nothing would be orphaned or cascaded by deleting it. */
export async function findDependents(user, db = { all }) {
  const present = await existingColumns(db)
  const found = []
  const count = async (ref, sql, param) => {
    if (!present.has(`${ref.table}.${ref.column}`)) return
    const rows = await db.all(sql, [param])
    const n = Number(rows[0]?.n || 0)
    if (n > 0) found.push({ table: ref.table, column: ref.column, count: n })
  }
  for (const ref of AUTHORED_REFERENCES) {
    const extra = ref.where ? ` AND ${ref.where}` : ''
    await count(
      ref,
      `SELECT COUNT(*)::int AS n FROM ${ref.table} WHERE LOWER(TRIM(${ref.column})) = LOWER(?)${extra}`,
      user.email,
    )
  }
  for (const ref of USER_ID_REFERENCES) {
    await count(ref, `SELECT COUNT(*)::int AS n FROM ${ref.table} WHERE ${ref.column} = ?`, user.id)
  }
  return found
}

/**
 * Decide what an existing login means for a signup of `email` (already
 * trimmed and lower-cased by the caller). `db` lets the route run this inside
 * the same transaction that acts on the answer.
 */
export async function classifyExistingLogin(email, db) {
  const user = await db.get(
    'SELECT id, email, status, active FROM users WHERE LOWER(email) = LOWER(?) ORDER BY id LIMIT 1',
    [email],
  )
  if (!user) return { kind: 'none' }
  if (user.active === false) return { kind: 'refused', reason: 'deprovisioned', user }
  // users.status is NOT NULL DEFAULT 'Active'; treat an absent value the same.
  if ((user.status ?? 'Active') === 'Active') return { kind: 'active', user }

  // Deactivate (JL-192) keeps the member row; Delete (JL-325) removes it. A
  // surviving Deactivated member is a suspension only an admin may lift.
  const member = await db.get(
    'SELECT id, status FROM members WHERE LOWER(email) = LOWER(?) ORDER BY id LIMIT 1',
    [email],
  )
  if (member?.status === 'Deactivated') return { kind: 'refused', reason: 'suspended', user }

  const dependents = await findDependents(user, db)
  return dependents.length
    ? { kind: 'reactivate', user, dependents }
    : { kind: 'replace', user }
}

/**
 * Admin-facing record of WHY a signup was refused, since the user-facing
 * message is deliberately vague. Lands in user_audit_log, which admins read
 * per address at GET /api/members/audit?target=<email>. Best-effort.
 */
export async function logSignupRejection(email, reason, db) {
  console.warn(`[signup] refused ${email}: ${reason}`)
  try {
    await db.run(
      `INSERT INTO user_audit_log (actor, target_email, action, after_value, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      ['system', email, 'signup_rejected', reason],
    )
  } catch (err) {
    console.error(`[signup] could not record rejection for ${email}: ${err.message}`)
  }
}
