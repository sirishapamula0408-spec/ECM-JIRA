import { all } from '../db.js'
import { SPACE_ROLES } from '../routes/spaces.js'

/*
 * JL-152 — one place that decides which wiki pages a caller may see.
 *
 * The Confluence Lite home page reads pages from three different angles at
 * once (recently viewed, starred, recently created) and then lists Spaces and
 * an activity feed beside them. Each of those is a separate query, and the
 * brief is explicit that a page or Space the user cannot view must never
 * appear in ANY of them.
 *
 * Five queries each doing their own filtering is five chances to get it wrong,
 * and the one that forgets is silent — it leaks rather than errors. This repo
 * has paid for that shape twice already (two HTML sanitisers in JL-359, two
 * member directories in JL-425), so the rule is stated once, here, and every
 * home-page query is built on top of it.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 *   1. Deleted pages are invisible. Soft delete (JL-93) leaves the row in
 *      place, so this is a filter and not a consequence of the row being gone.
 *   2. A draft is visible only to its author (JL-95).
 *   3. A page in a Space is visible only if the Space is. That is
 *      resolveSpaceRole's decision, not a second opinion formed here.
 *   4. A page in a project is visible only if the project is. Projects ARE
 *      membership-filtered (JL-224), with workspace Admin/Owner bypassing —
 *      this mirrors GET /api/projects rather than restating it.
 *
 * A page with neither a space_id nor a project_id is orphaned and treated as
 * visible: it predates both columns, and hiding it would make pages written
 * before Confluence Lite disappear from their own authors.
 */

/** True when this user is a workspace Admin or Owner. Mirrors authorize.js. */
function isWorkspaceAdmin(user) {
  const role = String(user?.workspaceRole || '')
  return role === 'Admin' || role === 'Owner' || user?.isOwner === true
}

/**
 * The role this caller holds in `space`, computed from data already loaded.
 *
 * A deliberate line-by-line mirror of resolveSpaceRole in routes/spaces.js —
 * same order, same fallbacks — differing only in that the membership lookup is
 * handed in rather than queried per call. Keep the two in step;
 * `wiki-home-JL152.test.js` fails if they disagree.
 */
function spaceRoleFrom(space, ctx) {
  if (!space) return null
  if (ctx.admin) return 'Admin'
  if (!ctx.email) return null
  if (String(space.owner_email || '').toLowerCase() === ctx.email.toLowerCase()) return 'Admin'
  const role = ctx.memberOf.get(space.id)
  /*
   * The Viewer fallback (JL-85: Spaces are open-read inside a workspace) is
   * the single line JL-87 will replace with `return null` for a restricted
   * Space. When it does, this function and resolveSpaceRole must change
   * together — which is what the equivalence test is there to force.
   */
  return role && SPACE_ROLES.includes(role) ? role : 'Viewer'
}

/**
 * The Space ids this caller can see, as a Set.
 *
 * The BATCHED form of resolveSpaceRole — the same decision asked about every
 * Space at once instead of one at a time. It exists because the home page
 * would otherwise issue a membership query per Space on every load.
 */
export async function visibleSpaceIds(user) {
  const spaces = await all('SELECT id, owner_email FROM spaces')
  if (!spaces.length) return new Set()

  const email = String(user?.email || '').trim()
  const admin = isWorkspaceAdmin(user)

  // One membership query covering every Space, instead of one per Space.
  const memberOf = new Map()
  if (!admin && email) {
    const rows = await all(
      'SELECT space_id, role FROM space_members WHERE LOWER(user_email) = LOWER(?)',
      [email],
    )
    for (const row of rows) memberOf.set(row.space_id, row.role)
  }

  const ctx = { email, admin, memberOf }
  return new Set(spaces.filter((s) => spaceRoleFrom(s, ctx) !== null).map((s) => s.id))
}

/**
 * The project ids this caller can see, as a Set, or `null` meaning "all".
 *
 * Mirrors GET /api/projects (JL-224): workspace Admin/Owner see everything,
 * everyone else sees projects they are a member or the lead of.
 */
export async function visibleProjectIds(user) {
  if (isWorkspaceAdmin(user)) return null
  const email = String(user?.email || '').trim()
  if (!email) return new Set()

  const rows = await all(
    `SELECT DISTINCT p.id
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id
       LEFT JOIN members m ON m.id = pm.member_id
      WHERE LOWER(m.email) = LOWER(?) OR LOWER(p.lead) = LOWER(?)`,
    [email, email],
  )
  return new Set(rows.map((r) => r.id))
}

/**
 * Build the SQL fragment that filters `wiki_pages` to what this caller may see.
 *
 * Returns `{ clause, params }` where `clause` is already parenthesised and
 * ready to AND into a WHERE, and `params` lines up with the `?` placeholders
 * (db.js converts those to $1..$n).
 *
 * @param {object} user  req.user
 * @param {string} [alias] table alias used in the caller's query
 */
export async function pageVisibilityFilter(user, alias = 'w') {
  const a = alias ? `${alias}.` : ''
  const email = String(user?.email || '')
  const spaceIds = await visibleSpaceIds(user)
  const projectIds = await visibleProjectIds(user)

  const parts = [`${a}deleted_at IS NULL`]
  const params = []

  // A draft belongs to its author until published.
  parts.push(`(${a}status <> 'draft' OR LOWER(${a}created_by) = LOWER(?))`)
  params.push(email)

  /*
   * An empty id set cannot go into `IN ()` — that is a syntax error in
   * PostgreSQL — so the "no access to anything" case becomes FALSE explicitly.
   * Getting this wrong fails open, which is the direction that matters.
   */
  if (spaceIds.size === 0) {
    parts.push(`${a}space_id IS NULL`)
  } else {
    parts.push(`(${a}space_id IS NULL OR ${a}space_id IN (${[...spaceIds].map(() => '?').join(', ')}))`)
    params.push(...spaceIds)
  }

  if (projectIds === null) {
    // Workspace Admin/Owner: no project restriction at all.
  } else if (projectIds.size === 0) {
    parts.push(`${a}project_id IS NULL`)
  } else {
    parts.push(`(${a}project_id IS NULL OR ${a}project_id IN (${[...projectIds].map(() => '?').join(', ')}))`)
    params.push(...projectIds)
  }

  return { clause: `(${parts.join(' AND ')})`, params }
}
