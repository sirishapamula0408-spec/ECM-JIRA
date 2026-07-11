import crypto from 'node:crypto'
import { Router } from 'express'
import { get, all, run } from '../db.js'
import { getScimToken } from '../config.js'
import { safeEqual } from '../utils/safeEqual.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { hashPassword } from '../middleware/validate.js'

/* ============================================================
   JL-130: SCIM 2.0 user & group provisioning
   ------------------------------------------------------------
   A dependency-free implementation of the SCIM 2.0 REST/JSON
   standard that maps onto the existing `users` (+ `members`)
   tables and a minimal `scim_groups` model. Enterprise IdPs
   (Okta / Azure AD) call these endpoints with a shared bearer
   token (config `SCIM_TOKEN`) to provision and deprovision
   accounts.
   ============================================================ */

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group'
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'

const SCIM_CONTENT_TYPE = 'application/scim+json'

/* ---------------------- pure helpers (unit-tested) ---------------------- */

/**
 * Map a `users` table row to a SCIM 2.0 User resource.
 * Pure — no DB access — so it can be unit tested directly.
 */
export function toScimUser(row) {
  if (!row) return null
  const email = row.email || ''
  const displayName = row.display_name || ''
  // Derive given/family names from a display name, falling back to the email
  // local-part so `name` is always populated for IdPs that expect it.
  const nameSource = displayName || email.split('@')[0] || ''
  const parts = nameSource.trim().split(/\s+/).filter(Boolean)
  const givenName = parts[0] || ''
  const familyName = parts.length > 1 ? parts.slice(1).join(' ') : ''

  const created = row.created_at
    ? new Date(row.created_at).toISOString()
    : new Date().toISOString()

  const resource = {
    schemas: [USER_SCHEMA],
    id: String(row.id),
    userName: email,
    name: {
      formatted: nameSource,
      givenName,
      familyName,
    },
    displayName: displayName || nameSource,
    emails: email ? [{ value: email, primary: true, type: 'work' }] : [],
    // Column defaults to TRUE; treat only an explicit false as inactive.
    active: row.active !== false && row.active !== 0,
    meta: {
      resourceType: 'User',
      created,
      lastModified: created,
      location: `/scim/v2/Users/${row.id}`,
    },
  }
  if (row.scim_external_id) resource.externalId = row.scim_external_id
  return resource
}

/**
 * Map a `scim_groups` row (+ optional member user ids) to a SCIM Group.
 */
export function toScimGroup(row, memberRows = []) {
  if (!row) return null
  const created = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
  const modified = row.updated_at ? new Date(row.updated_at).toISOString() : created
  const resource = {
    schemas: [GROUP_SCHEMA],
    id: String(row.id),
    displayName: row.display_name,
    members: (memberRows || []).map((m) => ({
      value: String(m.user_id ?? m.id),
      $ref: `/scim/v2/Users/${m.user_id ?? m.id}`,
    })),
    meta: {
      resourceType: 'Group',
      created,
      lastModified: modified,
      location: `/scim/v2/Groups/${row.id}`,
    },
  }
  if (row.external_id) resource.externalId = row.external_id
  return resource
}

/**
 * Parse a SCIM filter expression such as `userName eq "a@b.com"`.
 * Returns `{ attribute, operator, value }` or `null` when it cannot be parsed.
 * Pure — unit tested directly.
 */
export function parseScimFilter(filterStr) {
  if (!filterStr || typeof filterStr !== 'string') return null
  const m = filterStr
    .trim()
    .match(/^(\w[\w.:]*)\s+(eq|ne|co|sw|ew|pr|gt|ge|lt|le)\b\s*(?:"([^"]*)"|(\S+))?$/i)
  if (!m) return null
  const [, attribute, op, quoted, bare] = m
  let value = quoted !== undefined ? quoted : bare
  if (value === 'true') value = true
  else if (value === 'false') value = false
  return { attribute, operator: op.toLowerCase(), value }
}

/** Build a SCIM ListResponse envelope. */
export function buildListResponse(resources, totalResults, startIndex, itemsPerPage) {
  return {
    schemas: [LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage,
    Resources: resources,
  }
}

function scimError(res, status, detail, scimType) {
  const body = { schemas: [ERROR_SCHEMA], detail, status: String(status) }
  if (scimType) body.scimType = scimType
  return res.status(status).type(SCIM_CONTENT_TYPE).json(body)
}

function sendScim(res, status, body) {
  return res.status(status).type(SCIM_CONTENT_TYPE).json(body)
}

/* ---------------------- auth middleware ---------------------- */

/**
 * Guard every SCIM route with the shared bearer token.
 *
 * JL-184: when SCIM_TOKEN is not configured, SCIM provisioning is disabled —
 * respond 501 for every request rather than accepting a hard-coded default
 * (mirrors the JL-81/JL-129 config-gated SSO pattern). When configured, the
 * bearer token must match, compared in constant time via `safeEqual` to avoid
 * leaking the secret through response timing. Responds 401 when the token is
 * missing, malformed, or incorrect.
 */
export function scimAuth(req, res, next) {
  const scimToken = getScimToken()
  if (!scimToken) {
    return scimError(res, 501, 'SCIM provisioning is not configured on this server')
  }
  const header = req.headers.authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  const token = match ? match[1].trim() : ''
  if (!safeEqual(token, scimToken)) {
    return scimError(res, 401, 'Unauthorized: a valid SCIM bearer token is required')
  }
  return next()
}

/* ---------------------- router ---------------------- */

const router = Router()
router.use(scimAuth)

/* ============================ Users ============================ */

// GET /scim/v2/Users — list with pagination + optional filter
router.get('/Users', asyncHandler(async (req, res) => {
  const startIndex = Math.max(1, parseInt(req.query.startIndex, 10) || 1)
  const count = Math.max(0, parseInt(req.query.count, 10) || 100)
  const offset = startIndex - 1

  const filter = parseScimFilter(req.query.filter)
  let whereSql = ''
  const whereParams = []
  if (filter && filter.operator === 'eq') {
    if (filter.attribute.toLowerCase() === 'username') {
      whereSql = 'WHERE LOWER(email) = LOWER(?)'
      whereParams.push(String(filter.value))
    } else if (filter.attribute.toLowerCase() === 'externalid') {
      whereSql = 'WHERE scim_external_id = ?'
      whereParams.push(String(filter.value))
    } else if (filter.attribute.toLowerCase() === 'active') {
      whereSql = 'WHERE active = ?'
      whereParams.push(Boolean(filter.value))
    }
  }

  const countRow = await get(`SELECT COUNT(*) AS total FROM users ${whereSql}`, whereParams)
  const totalResults = Number(countRow?.total || 0)

  const rows = await all(
    `SELECT id, email, display_name, active, scim_external_id, created_at
     FROM users ${whereSql}
     ORDER BY id ASC
     LIMIT ? OFFSET ?`,
    [...whereParams, count, offset],
  )

  const resources = rows.map(toScimUser)
  return sendScim(res, 200, buildListResponse(resources, totalResults, startIndex, resources.length))
}))

// GET /scim/v2/Users/:id
router.get('/Users/:id', asyncHandler(async (req, res) => {
  const row = await get(
    'SELECT id, email, display_name, active, scim_external_id, created_at FROM users WHERE id = ?',
    [req.params.id],
  )
  if (!row) return scimError(res, 404, `User ${req.params.id} not found`)
  return sendScim(res, 200, toScimUser(row))
}))

// POST /scim/v2/Users — provision a new user
router.post('/Users', asyncHandler(async (req, res) => {
  const body = req.body || {}
  const email = String(body.userName || body.emails?.[0]?.value || '').trim().toLowerCase()
  if (!email) return scimError(res, 400, 'userName is required', 'invalidValue')

  const displayName =
    body.displayName ||
    body.name?.formatted ||
    [body.name?.givenName, body.name?.familyName].filter(Boolean).join(' ') ||
    email.split('@')[0]
  const active = body.active === undefined ? true : Boolean(body.active)
  const externalId = body.externalId || null

  const existing = await get('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email])
  if (existing) return scimError(res, 409, 'A user with this userName already exists', 'uniqueness')

  // IdP-managed accounts sign in via SSO; store a random unusable password hash.
  const passwordHash = hashPassword(crypto.randomBytes(24).toString('hex'))
  const created = await run(
    'INSERT INTO users (email, password_hash, display_name, active, scim_external_id) VALUES (?, ?, ?, ?, ?)',
    [email, passwordHash, displayName, active, externalId],
  )

  // Best-effort: mirror into the members directory so the user shows up in the
  // app. Guarded so it never insert-duplicates or blocks provisioning.
  try {
    await run(
      `INSERT INTO members (name, email, role, status, task_count, invited_by, is_owner)
       SELECT ?, ?, 'Viewer', ?, 0, 'SCIM', FALSE
       WHERE NOT EXISTS (SELECT 1 FROM members WHERE LOWER(email) = LOWER(?))`,
      [displayName, email, active ? 'Active' : 'Inactive', email],
    )
  } catch (err) {
    console.error(`[scim] member mirror skipped for ${email}: ${err.message}`)
  }

  const row = await get(
    'SELECT id, email, display_name, active, scim_external_id, created_at FROM users WHERE id = ?',
    [created.lastID],
  )
  return sendScim(res, 201, toScimUser(row))
}))

async function applyUserUpdate(id, fields) {
  const sets = []
  const params = []
  if (fields.email !== undefined) { sets.push('email = ?'); params.push(fields.email) }
  if (fields.displayName !== undefined) { sets.push('display_name = ?'); params.push(fields.displayName) }
  if (fields.active !== undefined) { sets.push('active = ?'); params.push(Boolean(fields.active)) }
  if (fields.externalId !== undefined) { sets.push('scim_external_id = ?'); params.push(fields.externalId) }
  if (!sets.length) return
  params.push(id)
  await run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params)
}

// PUT /scim/v2/Users/:id — full replace
router.put('/Users/:id', asyncHandler(async (req, res) => {
  const id = req.params.id
  const existing = await get('SELECT id FROM users WHERE id = ?', [id])
  if (!existing) return scimError(res, 404, `User ${id} not found`)

  const body = req.body || {}
  const email = String(body.userName || body.emails?.[0]?.value || '').trim().toLowerCase()
  const displayName =
    body.displayName ||
    body.name?.formatted ||
    [body.name?.givenName, body.name?.familyName].filter(Boolean).join(' ') ||
    undefined
  await applyUserUpdate(id, {
    email: email || undefined,
    displayName,
    active: body.active === undefined ? undefined : Boolean(body.active),
    externalId: body.externalId,
  })

  const row = await get(
    'SELECT id, email, display_name, active, scim_external_id, created_at FROM users WHERE id = ?',
    [id],
  )
  return sendScim(res, 200, toScimUser(row))
}))

// PATCH /scim/v2/Users/:id — partial update (incl. active=false deprovision)
router.patch('/Users/:id', asyncHandler(async (req, res) => {
  const id = req.params.id
  const existing = await get('SELECT id FROM users WHERE id = ?', [id])
  if (!existing) return scimError(res, 404, `User ${id} not found`)

  const ops = Array.isArray(req.body?.Operations) ? req.body.Operations : []
  const fields = {}
  for (const op of ops) {
    const operation = String(op.op || '').toLowerCase()
    if (operation === 'remove') continue
    const path = op.path ? String(op.path).toLowerCase() : ''
    if (path) {
      // Targeted op: `path` names the attribute, `value` is the new value.
      if (path === 'active') fields.active = op.value === true || op.value === 'true'
      else if (path === 'username') fields.email = String(op.value).trim().toLowerCase()
      else if (path === 'displayname' || path === 'name.formatted') fields.displayName = op.value
      else if (path === 'externalid') fields.externalId = op.value
    } else if (op.value && typeof op.value === 'object') {
      // Pathless replace: `value` is an object of attributes (Azure AD style).
      const v = op.value
      if (v.active !== undefined) fields.active = v.active === true || v.active === 'true'
      if (v.userName) fields.email = String(v.userName).trim().toLowerCase()
      if (v.displayName) fields.displayName = v.displayName
      if (v.name?.formatted) fields.displayName = v.name.formatted
      if (v.externalId) fields.externalId = v.externalId
    }
  }

  await applyUserUpdate(id, fields)

  // Keep the members directory status in sync when active toggles.
  if (fields.active !== undefined) {
    try {
      const row0 = await get('SELECT email FROM users WHERE id = ?', [id])
      if (row0?.email) {
        await run('UPDATE members SET status = ? WHERE LOWER(email) = LOWER(?)', [
          fields.active ? 'Active' : 'Inactive',
          row0.email,
        ])
      }
    } catch (err) {
      console.error(`[scim] member status sync skipped: ${err.message}`)
    }
  }

  const row = await get(
    'SELECT id, email, display_name, active, scim_external_id, created_at FROM users WHERE id = ?',
    [id],
  )
  return sendScim(res, 200, toScimUser(row))
}))

// DELETE /scim/v2/Users/:id — deprovision (soft delete: deactivate)
router.delete('/Users/:id', asyncHandler(async (req, res) => {
  const id = req.params.id
  const existing = await get('SELECT id, email FROM users WHERE id = ?', [id])
  if (!existing) return scimError(res, 404, `User ${id} not found`)

  await run('UPDATE users SET active = FALSE WHERE id = ?', [id])
  try {
    if (existing.email) {
      await run('UPDATE members SET status = ? WHERE LOWER(email) = LOWER(?)', ['Inactive', existing.email])
    }
  } catch (err) {
    console.error(`[scim] member deactivate skipped: ${err.message}`)
  }
  return res.status(204).end()
}))

/* ============================ Groups ============================ */

// GET /scim/v2/Groups — list
router.get('/Groups', asyncHandler(async (req, res) => {
  const startIndex = Math.max(1, parseInt(req.query.startIndex, 10) || 1)
  const count = Math.max(0, parseInt(req.query.count, 10) || 100)
  const offset = startIndex - 1

  const filter = parseScimFilter(req.query.filter)
  let whereSql = ''
  const whereParams = []
  if (filter && filter.operator === 'eq' && filter.attribute.toLowerCase() === 'displayname') {
    whereSql = 'WHERE display_name = ?'
    whereParams.push(String(filter.value))
  }

  const countRow = await get(`SELECT COUNT(*) AS total FROM scim_groups ${whereSql}`, whereParams)
  const totalResults = Number(countRow?.total || 0)

  const rows = await all(
    `SELECT id, display_name, external_id, created_at, updated_at
     FROM scim_groups ${whereSql}
     ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...whereParams, count, offset],
  )
  const resources = []
  for (const g of rows) {
    const members = await all('SELECT user_id FROM scim_group_members WHERE group_id = ?', [g.id])
    resources.push(toScimGroup(g, members))
  }
  return sendScim(res, 200, buildListResponse(resources, totalResults, startIndex, resources.length))
}))

// GET /scim/v2/Groups/:id
router.get('/Groups/:id', asyncHandler(async (req, res) => {
  const g = await get(
    'SELECT id, display_name, external_id, created_at, updated_at FROM scim_groups WHERE id = ?',
    [req.params.id],
  )
  if (!g) return scimError(res, 404, `Group ${req.params.id} not found`)
  const members = await all('SELECT user_id FROM scim_group_members WHERE group_id = ?', [g.id])
  return sendScim(res, 200, toScimGroup(g, members))
}))

async function setGroupMembers(groupId, memberValues) {
  if (!Array.isArray(memberValues)) return
  await run('DELETE FROM scim_group_members WHERE group_id = ?', [groupId])
  for (const m of memberValues) {
    const userId = parseInt(m?.value ?? m, 10)
    if (!Number.isInteger(userId)) continue
    await run(
      `INSERT INTO scim_group_members (group_id, user_id) VALUES (?, ?)
       ON CONFLICT (group_id, user_id) DO NOTHING RETURNING group_id`,
      [groupId, userId],
    )
  }
}

// POST /scim/v2/Groups — create
router.post('/Groups', asyncHandler(async (req, res) => {
  const body = req.body || {}
  const displayName = String(body.displayName || '').trim()
  if (!displayName) return scimError(res, 400, 'displayName is required', 'invalidValue')

  const existing = await get('SELECT id FROM scim_groups WHERE display_name = ?', [displayName])
  if (existing) return scimError(res, 409, 'A group with this displayName already exists', 'uniqueness')

  const created = await run(
    'INSERT INTO scim_groups (display_name, external_id) VALUES (?, ?)',
    [displayName, body.externalId || null],
  )
  await setGroupMembers(created.lastID, body.members)

  const g = await get(
    'SELECT id, display_name, external_id, created_at, updated_at FROM scim_groups WHERE id = ?',
    [created.lastID],
  )
  const members = await all('SELECT user_id FROM scim_group_members WHERE group_id = ?', [created.lastID])
  return sendScim(res, 201, toScimGroup(g, members))
}))

// PATCH /scim/v2/Groups/:id — update name / members
router.patch('/Groups/:id', asyncHandler(async (req, res) => {
  const id = req.params.id
  const g0 = await get('SELECT id FROM scim_groups WHERE id = ?', [id])
  if (!g0) return scimError(res, 404, `Group ${id} not found`)

  const ops = Array.isArray(req.body?.Operations) ? req.body.Operations : []
  for (const op of ops) {
    const operation = String(op.op || '').toLowerCase()
    const path = op.path ? String(op.path).toLowerCase() : ''
    if (path === 'displayname') {
      await run('UPDATE scim_groups SET display_name = ?, updated_at = NOW() WHERE id = ?', [op.value, id])
    } else if (path === 'members') {
      if (operation === 'replace') {
        await setGroupMembers(id, op.value)
      } else if (operation === 'add') {
        for (const m of op.value || []) {
          const userId = parseInt(m?.value ?? m, 10)
          if (Number.isInteger(userId)) {
            await run(
              `INSERT INTO scim_group_members (group_id, user_id) VALUES (?, ?)
               ON CONFLICT (group_id, user_id) DO NOTHING RETURNING group_id`,
              [id, userId],
            )
          }
        }
      } else if (operation === 'remove') {
        for (const m of op.value || []) {
          const userId = parseInt(m?.value ?? m, 10)
          if (Number.isInteger(userId)) {
            await run('DELETE FROM scim_group_members WHERE group_id = ? AND user_id = ?', [id, userId])
          }
        }
      }
    } else if (!path && op.value && typeof op.value === 'object') {
      if (op.value.displayName) {
        await run('UPDATE scim_groups SET display_name = ?, updated_at = NOW() WHERE id = ?', [op.value.displayName, id])
      }
      if (Array.isArray(op.value.members)) {
        await setGroupMembers(id, op.value.members)
      }
    }
  }

  const g = await get(
    'SELECT id, display_name, external_id, created_at, updated_at FROM scim_groups WHERE id = ?',
    [id],
  )
  const members = await all('SELECT user_id FROM scim_group_members WHERE group_id = ?', [id])
  return sendScim(res, 200, toScimGroup(g, members))
}))

// PUT /scim/v2/Groups/:id — full replace
router.put('/Groups/:id', asyncHandler(async (req, res) => {
  const id = req.params.id
  const g0 = await get('SELECT id FROM scim_groups WHERE id = ?', [id])
  if (!g0) return scimError(res, 404, `Group ${id} not found`)

  const body = req.body || {}
  if (body.displayName) {
    await run('UPDATE scim_groups SET display_name = ?, external_id = ?, updated_at = NOW() WHERE id = ?', [
      body.displayName,
      body.externalId || null,
      id,
    ])
  }
  if (Array.isArray(body.members)) await setGroupMembers(id, body.members)

  const g = await get(
    'SELECT id, display_name, external_id, created_at, updated_at FROM scim_groups WHERE id = ?',
    [id],
  )
  const members = await all('SELECT user_id FROM scim_group_members WHERE group_id = ?', [id])
  return sendScim(res, 200, toScimGroup(g, members))
}))

// DELETE /scim/v2/Groups/:id
router.delete('/Groups/:id', asyncHandler(async (req, res) => {
  const id = req.params.id
  const g0 = await get('SELECT id FROM scim_groups WHERE id = ?', [id])
  if (!g0) return scimError(res, 404, `Group ${id} not found`)
  await run('DELETE FROM scim_groups WHERE id = ?', [id])
  return res.status(204).end()
}))

export default router
