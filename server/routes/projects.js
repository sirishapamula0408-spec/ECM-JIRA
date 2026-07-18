import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { loadProjectRole, requireProjectRole } from '../middleware/authorize.js'
import { maxLengthError, PROJECT_NAME_MAX, PROJECT_KEY_MAX } from '../utils/validation.js'
import { getProjectCreationPolicy } from './workspaceSettings.js'

const router = Router()

const ROLE_RANK = { Viewer: 1, Member: 2, Admin: 3 }

/**
 * JL-211: Enforce the configurable workspace `project_creation_policy`.
 *   - Owner always allowed.
 *   - 'admins_only'  → workspace Admin/Owner only (Member/Viewer → 403).
 *   - 'all_members'  → workspace Member+ (preserves the legacy requireRole('Member')).
 */
async function enforceProjectCreationPolicy(req, res, next) {
  try {
    if (req.user?.isOwner) return next()

    const policy = await getProjectCreationPolicy()
    const minRank = policy === 'admins_only' ? ROLE_RANK.Admin : ROLE_RANK.Member
    const userRank = ROLE_RANK[req.user?.workspaceRole] || 0

    if (userRank >= minRank) return next()

    res.status(403).json({ error: 'Insufficient permissions to create projects' })
  } catch (err) {
    next(err)
  }
}

router.get('/', asyncHandler(async (req, res) => {
  const userEmail = req.user?.email
  if (!userEmail) {
    res.json([])
    return
  }

  // Find the member record for the logged-in user
  const member = await get('SELECT id, name FROM members WHERE LOWER(email) = LOWER(?)', [userEmail])

  // JL-96: scope the listing to the resolved workspace. `req.workspaceId` is set
  // by the resolveWorkspace middleware (verified against workspace_members).
  // Legacy rows with a NULL workspace_id stay visible under any workspace so
  // single-tenant/pre-migration installs are unaffected. When no workspace could
  // be resolved (null), we skip the filter entirely for backward compatibility.
  // Full per-table isolation for other entities is a follow-on (see workspace.js).
  const workspaceId = req.workspaceId ?? null
  const wsClause = workspaceId != null ? ' AND (p.workspace_id = ? OR p.workspace_id IS NULL)' : ''

  // Return projects where user is a member or the lead
  let rows
  if (member) {
    const params = [member.id, member.name]
    if (workspaceId != null) params.push(workspaceId)
    rows = await all(
      `SELECT DISTINCT p.* FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.member_id = ?
       WHERE (pm.member_id IS NOT NULL OR LOWER(p.lead) = LOWER(?))${wsClause}
       ORDER BY p.id ASC`,
      params,
    )
  } else {
    // Fallback: no member record yet — show projects where user email matches lead
    const leadClause = workspaceId != null ? ' AND (workspace_id = ? OR workspace_id IS NULL)' : ''
    const params = [userEmail]
    if (workspaceId != null) params.push(workspaceId)
    rows = await all(`SELECT * FROM projects WHERE LOWER(lead) = LOWER(?)${leadClause} ORDER BY id ASC`, params)
  }

  res.json(rows)
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM projects WHERE id = ?', [req.params.id])
  if (!row) {
    res.status(404).json({ error: 'Project not found' })
    return
  }
  res.json(row)
}))

router.post('/', enforceProjectCreationPolicy, asyncHandler(async (req, res) => {
  const { name, key, type, lead } = req.body
  const trimmedName = String(name || '').trim()
  const trimmedKey = String(key || '').trim()
  const trimmedType = String(type || 'Scrum').trim()
  const trimmedLead = String(lead || '').trim()

  if (!trimmedName || !trimmedKey || !trimmedType || !trimmedLead) {
    res.status(400).json({ error: 'name, key, type, and lead are required' })
    return
  }

  // JL-204: server-side length caps (checked after trim)
  const lengthErr =
    maxLengthError('name', trimmedName, PROJECT_NAME_MAX) ||
    maxLengthError('key', trimmedKey, PROJECT_KEY_MAX)
  if (lengthErr) {
    res.status(400).json({ error: lengthErr })
    return
  }

  // Resolve lead to member_id
  const userEmail = req.user?.email
  const member = userEmail
    ? await get('SELECT id FROM members WHERE LOWER(email) = LOWER(?)', [userEmail])
    : null
  const leadMemberId = member?.id || null

  const result = await run(
    'INSERT INTO projects (name, key, type, lead, lead_member_id) VALUES (?, ?, ?, ?, ?)',
    [trimmedName, trimmedKey, trimmedType, trimmedLead, leadMemberId],
  )
  const projectId = result.lastID

  // Auto-add the logged-in user as an Admin member of the new project
  if (member) {
    await run(
      'INSERT INTO project_members (project_id, member_id, role) VALUES (?, ?, ?) ON CONFLICT (project_id, member_id) DO NOTHING',
      [projectId, member.id, 'Admin'],
    )
  }

  res.status(201).json({
    id: projectId,
    name: trimmedName,
    key: trimmedKey,
    type: trimmedType,
    lead: trimmedLead,
    lead_member_id: leadMemberId,
    avatar_color: '#0052cc',
  })
}))

router.put('/:id', loadProjectRole, requireProjectRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid project id' })
    return
  }

  const project = await get('SELECT * FROM projects WHERE id = ?', [id])
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  const { name, key, type, lead } = req.body
  const updatedName = name !== undefined ? String(name).trim() : project.name
  const updatedKey = key !== undefined ? String(key).trim() : project.key
  const updatedType = type !== undefined ? String(type).trim() : project.type
  const updatedLead = lead !== undefined ? String(lead).trim() : project.lead

  // JL-204: length caps — only validate fields the caller actually sent, so a
  // legacy over-cap row can still be updated on unrelated fields.
  const lengthErr =
    (name !== undefined ? maxLengthError('name', updatedName, PROJECT_NAME_MAX) : null) ||
    (key !== undefined ? maxLengthError('key', updatedKey, PROJECT_KEY_MAX) : null)
  if (lengthErr) {
    res.status(400).json({ error: lengthErr })
    return
  }

  // Resolve lead_member_id when lead changes
  let updatedLeadMemberId = project.lead_member_id
  if (lead !== undefined) {
    const leadMember = await get('SELECT id FROM members WHERE LOWER(name) = LOWER(?)', [updatedLead])
    updatedLeadMemberId = leadMember?.id || null
  }

  await run(
    'UPDATE projects SET name = ?, key = ?, type = ?, lead = ?, lead_member_id = ? WHERE id = ?',
    [updatedName, updatedKey, updatedType, updatedLead, updatedLeadMemberId, id],
  )

  const updated = await get('SELECT * FROM projects WHERE id = ?', [id])
  res.json(updated)
}))

router.delete('/:id', loadProjectRole, requireProjectRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid project id' })
    return
  }

  const project = await get('SELECT * FROM projects WHERE id = ?', [id])
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  await run('UPDATE issues SET project_id = NULL WHERE project_id = ?', [id])
  await run('DELETE FROM project_members WHERE project_id = ?', [id])
  await run('DELETE FROM projects WHERE id = ?', [id])
  res.json({ ok: true })
}))

// ── Project Members ──

router.get('/:id/members', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  const rows = await all(
    `SELECT pm.id AS pm_id, pm.role AS project_role, pm.assigned_at,
            m.id, m.name, m.email, m.role AS global_role, m.status
     FROM project_members pm
     JOIN members m ON m.id = pm.member_id
     WHERE pm.project_id = ?
     ORDER BY pm.assigned_at ASC`,
    [projectId],
  )
  res.json(rows)
}))

router.post('/:id/members', loadProjectRole, requireProjectRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  const { memberId, role } = req.body
  const mid = Number(memberId)

  if (!Number.isInteger(mid)) {
    res.status(400).json({ error: 'memberId is required' })
    return
  }

  const validRole = ['Admin', 'Member', 'Viewer'].includes(role) ? role : 'Member'

  await run(
    'INSERT INTO project_members (project_id, member_id, role) VALUES (?, ?, ?)',
    [projectId, mid, validRole],
  )

  const row = await get(
    `SELECT pm.id AS pm_id, pm.role AS project_role, pm.assigned_at,
            m.id, m.name, m.email, m.role AS global_role, m.status
     FROM project_members pm
     JOIN members m ON m.id = pm.member_id
     WHERE pm.project_id = ? AND pm.member_id = ?`,
    [projectId, mid],
  )
  res.status(201).json(row)
}))

router.delete('/:id/members/:memberId', loadProjectRole, requireProjectRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  const memberId = Number(req.params.memberId)
  await run(
    'DELETE FROM project_members WHERE project_id = ? AND member_id = ?',
    [projectId, memberId],
  )
  res.json({ ok: true })
}))

export default router
