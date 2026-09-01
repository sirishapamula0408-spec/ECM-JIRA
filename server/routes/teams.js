import { Router } from 'express'
import crypto from 'node:crypto'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { sendError } from '../utils/httpError.js'
import { getStorage } from '../services/storage.js'
// JL-424: the association gate reuses the project-access resolution every other
// project-scoped route is built on. No parallel scheme.
import { loadProjectRole, requireProjectRole, resolveProjectAccess, ROLE_RANK } from '../middleware/authorize.js'
// JL-429/JL-434: the ONE URL allow-list in this codebase. src/utils/sanitizeHtml.js
// carries the JL-368 scheme allow-list and the JL-358 control-character
// normalisation; importing it here rather than re-deriving a server-side copy is
// the whole point — two allow-lists is what JL-359 deleted a sanitiser to stop.
import { isSafeUrl } from '../../src/utils/sanitizeHtml.js'

const router = Router()

// JL-420 AC#4: validated on write, never merely stored. seed.js once wrote roles
// outside VALID_ROLES and those users ranked BELOW Viewer (JL-417) — an invalid
// enum does not fail loudly, it fails quietly and wrongly.
export const MEMBERSHIP_MODES = ['OPEN', 'MEMBER_INVITE']
export const TEAM_ROLES = ['Lead', 'Member']

// Atlassian's documented per-team web-link limit. Enforced HERE because the API
// is reachable directly — a UI-only check is not a limit (JL-429).
export const MAX_TEAM_LINKS = 10

export const TEAM_NAME_MAX = 120
export const TEAM_DESCRIPTION_MAX = 2000
export const TEAM_LINK_LABEL_MAX = 120
export const TEAM_LINK_URL_MAX = 2048

// Team avatars go through the SAME storage service as attachments (local disk
// with an S3 driver behind a dynamic import). No second upload path — which is
// also why express.json is already at 25mb.
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const AVATAR_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

// An uploaded avatar is recorded as `storage:<key>`, not as a URL: the local
// backend has no publicly reachable URL for a key, so the bytes are served back
// through GET /api/teams/:id/avatar (authenticated, like attachment downloads).
// An externally-hosted avatar may be stored as a plain http(s) URL instead.
const STORAGE_PREFIX = 'storage:'

/**
 * Public shape of a team. `avatarUrl` is always something the client can fetch:
 * the stored URL when it is external, otherwise this team's avatar endpoint.
 */
function mapTeam(row, extra = {}) {
  if (!row) return null
  const stored = row.avatar_url || null
  const avatarUrl = stored
    ? (stored.startsWith(STORAGE_PREFIX) ? `/api/teams/${row.id}/avatar` : stored)
    : null
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description ?? null,
    avatarUrl,
    membership: row.membership,
    createdBy: row.created_by,
    createdAt: row.created_at,
    ...(row.memberCount !== undefined ? { memberCount: Number(row.memberCount) } : {}),
    ...extra,
  }
}

const mapLink = (row) => ({
  id: row.id,
  teamId: row.team_id,
  label: row.label,
  url: row.url,
  createdAt: row.created_at,
})

/**
 * The caller's tenant. Teams are workspace-scoped, so a request with no
 * resolvable workspace can see nothing: this FAILS CLOSED rather than degrading
 * to an unscoped query. `GET /api/activity` degraded to no WHERE clause at all
 * and needed JL-362 as a security fix; `GET /api/portal/requests` needed JL-349.
 * There is not going to be a third.
 */
function workspaceIdOf(req) {
  const id = Number(req?.workspaceId)
  return Number.isInteger(id) && id > 0 ? id : null
}

const isWorkspaceAdmin = (req) =>
  Boolean(req.user?.isOwner) || req.user?.workspaceRole === 'Admin'

/**
 * Load a team BY ID AND WORKSPACE. Every route funnels through this, so a team
 * in another workspace is indistinguishable from one that does not exist — the
 * caller gets a 404, which leaks neither the team's existence nor its id range.
 */
async function loadTeam(req, teamId) {
  const workspaceId = workspaceIdOf(req)
  if (!Number.isInteger(teamId) || teamId <= 0 || workspaceId === null) return null
  return get(
    `SELECT id, workspace_id, name, description, avatar_url, membership, created_by, created_at
       FROM teams WHERE id = ? AND workspace_id = ?`,
    [teamId, workspaceId],
  )
}

/** The caller's role on this team ('Lead' | 'Member' | null). */
async function teamRoleOf(req, teamId) {
  if (!req.user?.memberId) return null
  const row = await get(
    'SELECT role FROM team_members WHERE team_id = ? AND member_id = ?',
    [teamId, req.user.memberId],
  )
  return row?.role || null
}

/**
 * JL-420 authorization: edit / delete / manage members and links is a team
 * **Lead**, or a workspace Admin/Owner. Built on the roles authorize.js already
 * loads (req.user.workspaceRole / isOwner) — no parallel scheme.
 */
async function canManageTeam(req, teamId) {
  if (isWorkspaceAdmin(req)) return true
  return (await teamRoleOf(req, teamId)) === 'Lead'
}

/** Members of a team, Leads first then by name. */
function loadMembers(teamId) {
  return all(
    `SELECT tm.team_id, tm.member_id, tm.role, tm.joined_at, m.name, m.email
       FROM team_members tm
       JOIN members m ON m.id = tm.member_id
      WHERE tm.team_id = ?
      ORDER BY CASE WHEN tm.role = 'Lead' THEN 0 ELSE 1 END, LOWER(m.name) ASC`,
    [teamId],
  )
}

const mapMember = (row) => ({
  teamId: row.team_id,
  memberId: row.member_id,
  role: row.role,
  joinedAt: row.joined_at,
  name: row.name,
  email: row.email,
})

/** Count the Leads on a team — the last-Lead guard's input. */
async function leadCount(teamId) {
  const row = await get(
    "SELECT COUNT(*)::int AS count FROM team_members WHERE team_id = ? AND role = 'Lead'",
    [teamId],
  )
  return Number(row?.count ?? 0)
}

const trimmed = (value) => String(value ?? '').trim()

// ---------------------------------------------------------------------------
// JL-427 — Teams CRUD
// ---------------------------------------------------------------------------

// GET /api/teams — list the caller's workspace's teams. ?search= filters by name.
router.get('/', asyncHandler(async (req, res) => {
  const workspaceId = workspaceIdOf(req)
  if (workspaceId === null) return res.json([])

  const params = [workspaceId]
  let where = 't.workspace_id = ?'
  const search = trimmed(req.query.search)
  if (search) {
    where += ' AND t.name ILIKE ?'
    params.push(`%${search}%`)
  }

  const rows = await all(
    `SELECT t.id, t.workspace_id, t.name, t.description, t.avatar_url, t.membership,
            t.created_by, t.created_at,
            COUNT(tm.member_id)::int AS "memberCount"
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
      WHERE ${where}
      GROUP BY t.id
      ORDER BY LOWER(t.name) ASC`,
    params,
  )
  res.json(rows.map((row) => mapTeam(row)))
}))

// POST /api/teams — any workspace member may start a team (Atlassian's model).
router.post('/', asyncHandler(async (req, res) => {
  const workspaceId = workspaceIdOf(req)
  if (workspaceId === null) {
    return sendError(res, 400, 'No workspace context — a team must belong to a workspace')
  }

  const name = trimmed(req.body?.name)
  if (!name) return sendError(res, 400, 'Team name is required')
  if (name.length > TEAM_NAME_MAX) {
    return sendError(res, 400, `Team name must be ${TEAM_NAME_MAX} characters or fewer`)
  }

  const description = trimmed(req.body?.description)
  if (description.length > TEAM_DESCRIPTION_MAX) {
    return sendError(res, 400, `Description must be ${TEAM_DESCRIPTION_MAX} characters or fewer`)
  }

  const membership = req.body?.membership === undefined ? 'OPEN' : trimmed(req.body.membership)
  if (!MEMBERSHIP_MODES.includes(membership)) {
    return sendError(res, 400, `membership must be one of: ${MEMBERSHIP_MODES.join(', ')}`)
  }

  const created = await run(
    `INSERT INTO teams (workspace_id, name, description, membership, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [workspaceId, name, description || null, membership, req.user?.email || 'unknown'],
  )

  // JL-427: the creator becomes the team's first Lead. A caller with no
  // `members` row (possible for an admin-provisioned login) still gets the team
  // — it is simply leaderless until a workspace Admin adds someone.
  if (req.user?.memberId) {
    await run(
      // team_members has a composite PK and no `id` column, so run() must not be
      // allowed to auto-append `RETURNING id` (CLAUDE.md).
      `INSERT INTO team_members (team_id, member_id, role) VALUES (?, ?, 'Lead')
       ON CONFLICT DO NOTHING RETURNING team_id`,
      [created.lastID, req.user.memberId],
    )
  }

  const row = await get('SELECT * FROM teams WHERE id = ?', [created.lastID])
  res.status(201).json(mapTeam(row, { memberCount: req.user?.memberId ? 1 : 0 }))
}))

// GET /api/teams/:id — one team, with its members and links.
router.get('/:id', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')

  const [members, links] = await Promise.all([
    loadMembers(teamId),
    all('SELECT id, team_id, label, url, created_at FROM team_links WHERE team_id = ? ORDER BY id ASC', [teamId]),
  ])
  const viewerRole = await teamRoleOf(req, teamId)

  res.json(mapTeam(team, {
    members: members.map(mapMember),
    links: links.map(mapLink),
    memberCount: members.length,
    // Mirrors of the server's own gate so the UI can render read-only without
    // guessing — the server stays the authority either way.
    viewerRole,
    canManage: isWorkspaceAdmin(req) || viewerRole === 'Lead',
  }))
}))

// PATCH /api/teams/:id — name, description, membership mode.
router.patch('/:id', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')
  if (!(await canManageTeam(req, teamId))) {
    return sendError(res, 403, 'Only a team Lead or a workspace Admin can edit this team')
  }

  let name = team.name
  if (req.body?.name !== undefined) {
    name = trimmed(req.body.name)
    if (!name) return sendError(res, 400, 'Team name is required')
    if (name.length > TEAM_NAME_MAX) {
      return sendError(res, 400, `Team name must be ${TEAM_NAME_MAX} characters or fewer`)
    }
  }

  let description = team.description
  if (req.body?.description !== undefined) {
    description = trimmed(req.body.description)
    if (description.length > TEAM_DESCRIPTION_MAX) {
      return sendError(res, 400, `Description must be ${TEAM_DESCRIPTION_MAX} characters or fewer`)
    }
    description = description || null
  }

  let membership = team.membership
  if (req.body?.membership !== undefined) {
    membership = trimmed(req.body.membership)
    if (!MEMBERSHIP_MODES.includes(membership)) {
      return sendError(res, 400, `membership must be one of: ${MEMBERSHIP_MODES.join(', ')}`)
    }
  }

  await run(
    'UPDATE teams SET name = ?, description = ?, membership = ? WHERE id = ? AND workspace_id = ?',
    [name, description, membership, teamId, team.workspace_id],
  )
  const row = await get('SELECT * FROM teams WHERE id = ?', [teamId])
  res.json(mapTeam(row))
}))

// DELETE /api/teams/:id — members and links go with it via ON DELETE CASCADE.
router.delete('/:id', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')
  if (!(await canManageTeam(req, teamId))) {
    return sendError(res, 403, 'Only a team Lead or a workspace Admin can delete this team')
  }
  await run('DELETE FROM teams WHERE id = ? AND workspace_id = ?', [teamId, team.workspace_id])
  res.json({ success: true })
}))

// ---------------------------------------------------------------------------
// Team avatar — the SAME storage service attachments use (JL-420 / JL-432).
// ---------------------------------------------------------------------------

// POST /api/teams/:id/avatar — base64-over-JSON, exactly as attachments upload.
router.post('/:id/avatar', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')
  if (!(await canManageTeam(req, teamId))) {
    return sendError(res, 403, 'Only a team Lead or a workspace Admin can change the team photo')
  }

  const filename = trimmed(req.body?.filename) || 'avatar.png'
  const mime = trimmed(req.body?.mime)
  const dataBase64 = String(req.body?.dataBase64 || '')
  if (!dataBase64) return sendError(res, 400, 'dataBase64 is required')
  if (!AVATAR_MIME_TYPES.has(mime)) {
    return sendError(res, 400, `Team photo must be one of: ${[...AVATAR_MIME_TYPES].join(', ')}`)
  }

  const buffer = Buffer.from(dataBase64, 'base64')
  if (buffer.length === 0) return sendError(res, 400, 'Empty file')
  if (buffer.length > MAX_AVATAR_BYTES) {
    return sendError(res, 413, `Team photo is too large. Maximum allowed size is ${MAX_AVATAR_BYTES / (1024 * 1024)} MB`)
  }

  const storage = getStorage()
  const key = `team-${teamId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${filename.replace(/[^\w.-]/g, '_')}`
  await storage.put(key, buffer, mime)
  await run('UPDATE teams SET avatar_url = ? WHERE id = ? AND workspace_id = ?', [
    `${STORAGE_PREFIX}${key}`, teamId, team.workspace_id,
  ])

  const row = await get('SELECT * FROM teams WHERE id = ?', [teamId])
  res.status(201).json(mapTeam(row))
}))

// GET /api/teams/:id/avatar — stream the stored photo back (authenticated, the
// way attachment downloads are; a plain <img src> cannot send a Bearer header,
// so the client fetches this and makes an object URL).
router.get('/:id/avatar', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')
  const stored = team.avatar_url || ''
  if (!stored.startsWith(STORAGE_PREFIX)) return sendError(res, 404, 'Team has no uploaded photo')

  const storage = getStorage()
  try {
    const buffer = await storage.get(stored.slice(STORAGE_PREFIX.length))
    res.setHeader('Content-Type', 'application/octet-stream')
    res.send(buffer)
  } catch {
    return sendError(res, 404, 'Photo data missing')
  }
}))

// ---------------------------------------------------------------------------
// JL-428 — membership
// ---------------------------------------------------------------------------

// GET /api/teams/:id/members
router.get('/:id/members', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')
  const members = await loadMembers(teamId)
  res.json(members.map(mapMember))
}))

// POST /api/teams/:id/members — add someone, or join an OPEN team yourself.
router.post('/:id/members', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')

  const memberId = Number(req.body?.memberId ?? req.user?.memberId)
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return sendError(res, 400, 'memberId is required')
  }

  const role = req.body?.role === undefined ? 'Member' : trimmed(req.body.role)
  if (!TEAM_ROLES.includes(role)) {
    return sendError(res, 400, `role must be one of: ${TEAM_ROLES.join(', ')}`)
  }

  // JL-428 permission model:
  //  - team Lead or workspace Admin/Owner may add anyone, at any role;
  //  - with membership = 'OPEN' a workspace member may add THEMSELVES, and only
  //    ever as a plain Member (self-promotion to Lead is not a join);
  //  - with 'MEMBER_INVITE' self-join is refused outright.
  const isSelf = req.user?.memberId != null && memberId === req.user.memberId
  const manages = await canManageTeam(req, teamId)
  if (!manages) {
    if (!isSelf) {
      return sendError(res, 403, 'Only a team Lead or a workspace Admin can add members')
    }
    if (team.membership !== 'OPEN') {
      return sendError(res, 403, 'This team is invite-only — a team Lead adds members')
    }
    if (role !== 'Member') {
      return sendError(res, 403, 'You can only join as a Member')
    }
  }

  // The person must exist in this workspace. members.workspace_id is backfilled
  // to the default workspace on boot (see db.js), so a NULL is treated as "not
  // yet attributed" and accepted rather than locking legacy rows out.
  const person = await get(
    'SELECT id FROM members WHERE id = ? AND (workspace_id = ? OR workspace_id IS NULL)',
    [memberId, team.workspace_id],
  )
  if (!person) return sendError(res, 404, 'Member not found in this workspace')

  // Idempotent, the way watchers auto-watch is. Explicit RETURNING because
  // team_members has no `id` column for run() to append one to.
  await run(
    'INSERT INTO team_members (team_id, member_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING team_id',
    [teamId, memberId, role],
  )

  const members = await loadMembers(teamId)
  res.status(201).json(members.map(mapMember))
}))

// PATCH /api/teams/:id/members/:memberId — change someone's team role.
router.patch('/:id/members/:memberId', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const memberId = Number(req.params.memberId)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')
  if (!(await canManageTeam(req, teamId))) {
    return sendError(res, 403, 'Only a team Lead or a workspace Admin can change team roles')
  }

  const role = trimmed(req.body?.role)
  if (!TEAM_ROLES.includes(role)) {
    return sendError(res, 400, `role must be one of: ${TEAM_ROLES.join(', ')}`)
  }

  const existing = await get(
    'SELECT role FROM team_members WHERE team_id = ? AND member_id = ?',
    [teamId, memberId],
  )
  if (!existing) return sendError(res, 404, 'That person is not on this team')

  // JL-428, the last-Lead decision: REFUSE, do not auto-promote. This mirrors
  // the last-Admin protection the members API already has (JL-417) — refusing
  // states the rule; auto-promoting picks a leader nobody chose. The same guard
  // covers demotion (here) and removal (below), because "no Leads left" is the
  // same outcome either way.
  if (existing.role === 'Lead' && role !== 'Lead' && (await leadCount(teamId)) <= 1) {
    return sendError(res, 409, 'A team must keep at least one Lead. Promote someone else first.')
  }

  await run('UPDATE team_members SET role = ? WHERE team_id = ? AND member_id = ?', [role, teamId, memberId])
  const members = await loadMembers(teamId)
  res.json(members.map(mapMember))
}))

// DELETE /api/teams/:id/members/:memberId — remove someone, or leave yourself.
router.delete('/:id/members/:memberId', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const memberId = Number(req.params.memberId)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')

  // Leaving is always yours to do — in BOTH membership modes. JL-428 constrains
  // self-JOIN by mode ('MEMBER_INVITE' refuses it); it says nothing about
  // leaving, and trapping someone on a team is not a security control.
  const isSelf = req.user?.memberId != null && memberId === req.user.memberId
  if (!isSelf && !(await canManageTeam(req, teamId))) {
    return sendError(res, 403, 'Only a team Lead or a workspace Admin can remove members')
  }

  const existing = await get(
    'SELECT role FROM team_members WHERE team_id = ? AND member_id = ?',
    [teamId, memberId],
  )
  if (!existing) return sendError(res, 404, 'That person is not on this team')

  if (existing.role === 'Lead' && (await leadCount(teamId)) <= 1) {
    return sendError(res, 409, 'A team must keep at least one Lead. Promote someone else first.')
  }

  await run('DELETE FROM team_members WHERE team_id = ? AND member_id = ?', [teamId, memberId])
  const members = await loadMembers(teamId)
  res.json(members.map(mapMember))
}))

// ---------------------------------------------------------------------------
// JL-429 — links, with the 10-link cap enforced HERE
// ---------------------------------------------------------------------------

// GET /api/teams/:id/links
router.get('/:id/links', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')
  const rows = await all(
    'SELECT id, team_id, label, url, created_at FROM team_links WHERE team_id = ? ORDER BY id ASC',
    [teamId],
  )
  res.json(rows.map(mapLink))
}))

// POST /api/teams/:id/links
router.post('/:id/links', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')
  if (!(await canManageTeam(req, teamId))) {
    return sendError(res, 403, 'Only a team Lead or a workspace Admin can add team links')
  }

  const label = trimmed(req.body?.label)
  const url = trimmed(req.body?.url)
  if (!label) return sendError(res, 400, 'Link label is required')
  if (label.length > TEAM_LINK_LABEL_MAX) {
    return sendError(res, 400, `Link label must be ${TEAM_LINK_LABEL_MAX} characters or fewer`)
  }
  if (!url) return sendError(res, 400, 'Link URL is required')
  if (url.length > TEAM_LINK_URL_MAX) {
    return sendError(res, 400, `Link URL must be ${TEAM_LINK_URL_MAX} characters or fewer`)
  }

  // Never store what the client will refuse to render. isSafeUrl is the shared
  // allow-list, so `javascript:`, `data:`, `vbscript:`, a tab-split
  // `java<TAB>script:` (JL-358) and protocol-relative `//evil.com` are all
  // rejected at the API, not just in the browser.
  if (!isSafeUrl(url)) {
    return sendError(res, 400, 'Link URL must be an http(s) or mailto address')
  }

  // The cap, server-side, with a readable 4xx — not a 500 out of a constraint.
  const countRow = await get('SELECT COUNT(*)::int AS count FROM team_links WHERE team_id = ?', [teamId])
  if (Number(countRow?.count ?? 0) >= MAX_TEAM_LINKS) {
    return sendError(res, 409, `A team can have at most ${MAX_TEAM_LINKS} links. Remove one before adding another.`)
  }

  const created = await run(
    'INSERT INTO team_links (team_id, label, url) VALUES (?, ?, ?)',
    [teamId, label, url],
  )
  const row = await get('SELECT id, team_id, label, url, created_at FROM team_links WHERE id = ?', [created.lastID])
  res.status(201).json(mapLink(row))
}))

// DELETE /api/teams/:id/links/:linkId — deleting one frees a slot.
router.delete('/:id/links/:linkId', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')
  if (!(await canManageTeam(req, teamId))) {
    return sendError(res, 403, 'Only a team Lead or a workspace Admin can remove team links')
  }
  const linkId = Number(req.params.linkId)
  const existing = await get('SELECT id FROM team_links WHERE id = ? AND team_id = ?', [linkId, teamId])
  if (!existing) return sendError(res, 404, 'Link not found')
  await run('DELETE FROM team_links WHERE id = ? AND team_id = ?', [linkId, teamId])
  res.json({ success: true })
}))

// ---------------------------------------------------------------------------
// JL-424 - team <-> project association
//
// THIS IS VISIBILITY AND NAVIGATION ONLY. Being on a team grants NO project
// access whatsoever: nothing in server/middleware/authorize.js or
// server/services/projectAccess.js reads `team_projects`, and a test asserts
// they never start to. A workspace Viewer who joins a team associated with a
// project is still a Viewer on that project. If that ever changed, team
// membership would become a privilege-escalation path straight past
// `project_members`, quietly undoing the restrictive project Viewer JL-289
// worked to establish.
// ---------------------------------------------------------------------------

/** A project the caller's workspace owns, or null. */
async function loadProjectInWorkspace(req, projectId) {
  const workspaceId = workspaceIdOf(req)
  if (!Number.isInteger(projectId) || projectId <= 0 || workspaceId === null) return null
  // workspace_id is backfilled on boot but may be NULL on a legacy row; treat
  // NULL as 'not yet attributed' rather than locking those projects out.
  return get(
    'SELECT id, name, key FROM projects WHERE id = ? AND (workspace_id = ? OR workspace_id IS NULL)',
    [projectId, workspaceId],
  )
}

/**
 * May the caller change this project's team associations?
 *
 * Project Admin/Lead, or workspace Admin/Owner - the rule JL-424 specifies.
 * `resolveProjectAccess` is the same helper the project-role middleware is
 * built on; it is called directly here because `loadProjectRole` reads
 * `req.params.id` FIRST, and on /api/teams/:id/... that param is the TEAM id.
 * Letting it run would resolve a project role for a project id that is really a
 * team id - a silent mis-authorisation. The project-side router below has a
 * genuine :projectId param and uses the middleware pair as written.
 */
async function canManageAssociation(req, projectId) {
  const access = await resolveProjectAccess(req.user, projectId)
  if (access.admin) return true
  return (ROLE_RANK[access.projectRole] || 0) >= ROLE_RANK.Admin
}

const projectsOfTeam = (teamId) => all(
  `SELECT p.id, p.name, p.key
     FROM team_projects tp
     JOIN projects p ON p.id = tp.project_id
    WHERE tp.team_id = ?
    ORDER BY LOWER(p.name) ASC`,
  [teamId],
)

const ASSOCIATION_DENIED = 'Only a project Admin/Lead or a workspace Admin can change a project\u2019s teams'

// GET /api/teams/:id/projects - where this team works.
router.get('/:id/projects', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')
  res.json(await projectsOfTeam(teamId))
}))

// POST /api/teams/:id/projects - associate. Body: { projectId }
router.post('/:id/projects', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')

  const projectId = Number(req.body?.projectId)
  const project = await loadProjectInWorkspace(req, projectId)
  if (!project) return sendError(res, 404, 'Project not found')

  if (!(await canManageAssociation(req, projectId))) {
    return sendError(res, 403, ASSOCIATION_DENIED)
  }

  await run(
    // Composite PK, no id column - explicit RETURNING keeps run() from
    // appending RETURNING id. Idempotent, like watchers auto-watch.
    'INSERT INTO team_projects (team_id, project_id) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING team_id',
    [teamId, projectId],
  )
  res.status(201).json(await projectsOfTeam(teamId))
}))

// DELETE /api/teams/:id/projects/:projectId - dissociate.
router.delete('/:id/projects/:projectId', asyncHandler(async (req, res) => {
  const teamId = Number(req.params.id)
  const team = await loadTeam(req, teamId)
  if (!team) return sendError(res, 404, 'Team not found')

  const projectId = Number(req.params.projectId)
  const project = await loadProjectInWorkspace(req, projectId)
  if (!project) return sendError(res, 404, 'Project not found')

  if (!(await canManageAssociation(req, projectId))) {
    return sendError(res, 403, ASSOCIATION_DENIED)
  }

  await run('DELETE FROM team_projects WHERE team_id = ? AND project_id = ?', [teamId, projectId])
  res.json(await projectsOfTeam(teamId))
}))

/**
 * The project side of the same relation, mounted at /api with absolute
 * sub-paths (the Theme-1 convention). Here `:projectId` is a real project id,
 * so `loadProjectRole` + `requireProjectRole('Admin')` are used exactly as the
 * ticket asks - 'Admin' admits project Admin and Lead (Lead outranks Admin in
 * ROLE_RANK), and workspace Admin/Owner bypass.
 */
export const projectTeamsRouter = Router()

const teamsOfProject = (projectId, workspaceId) => all(
  `SELECT t.id, t.name, t.description, t.membership,
          COUNT(tm.member_id)::int AS "memberCount"
     FROM team_projects tp
     JOIN teams t ON t.id = tp.team_id
     LEFT JOIN team_members tm ON tm.team_id = t.id
    WHERE tp.project_id = ? AND t.workspace_id = ?
    GROUP BY t.id
    ORDER BY LOWER(t.name) ASC`,
  [projectId, workspaceId],
)

// GET /api/projects/:projectId/teams - any workspace member may read.
projectTeamsRouter.get('/projects/:projectId/teams', asyncHandler(async (req, res) => {
  const workspaceId = workspaceIdOf(req)
  if (workspaceId === null) return res.json([])
  const projectId = Number(req.params.projectId)
  const project = await loadProjectInWorkspace(req, projectId)
  if (!project) return sendError(res, 404, 'Project not found')
  res.json(await teamsOfProject(projectId, workspaceId))
}))

// POST /api/projects/:projectId/teams - associate from the project side.
projectTeamsRouter.post(
  '/projects/:projectId/teams',
  loadProjectRole,
  requireProjectRole('Admin'),
  asyncHandler(async (req, res) => {
    const workspaceId = workspaceIdOf(req)
    const projectId = Number(req.params.projectId)
    const project = await loadProjectInWorkspace(req, projectId)
    if (!project) return sendError(res, 404, 'Project not found')

    const teamId = Number(req.body?.teamId)
    const team = await loadTeam(req, teamId)
    if (!team) return sendError(res, 404, 'Team not found')

    await run(
      'INSERT INTO team_projects (team_id, project_id) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING team_id',
      [teamId, projectId],
    )
    res.status(201).json(await teamsOfProject(projectId, workspaceId))
  }),
)

// DELETE /api/projects/:projectId/teams/:teamId - dissociate from the project side.
projectTeamsRouter.delete(
  '/projects/:projectId/teams/:teamId',
  loadProjectRole,
  requireProjectRole('Admin'),
  asyncHandler(async (req, res) => {
    const workspaceId = workspaceIdOf(req)
    const projectId = Number(req.params.projectId)
    const project = await loadProjectInWorkspace(req, projectId)
    if (!project) return sendError(res, 404, 'Project not found')

    const teamId = Number(req.params.teamId)
    const team = await loadTeam(req, teamId)
    if (!team) return sendError(res, 404, 'Team not found')

    await run('DELETE FROM team_projects WHERE team_id = ? AND project_id = ?', [teamId, projectId])
    res.json(await teamsOfProject(projectId, workspaceId))
  }),
)
export default router
