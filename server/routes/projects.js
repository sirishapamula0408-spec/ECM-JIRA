import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

router.get('/', asyncHandler(async (req, res) => {
  const userEmail = req.user?.email
  if (!userEmail) {
    res.json([])
    return
  }

  // Find the member record for the logged-in user
  const member = await get('SELECT id, name FROM members WHERE LOWER(email) = LOWER(?)', [userEmail])

  // Return projects where user is a member or the lead
  let rows
  if (member) {
    rows = await all(
      `SELECT DISTINCT p.* FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.member_id = ?
       WHERE pm.member_id IS NOT NULL OR LOWER(p.lead) = LOWER(?)
       ORDER BY p.id ASC`,
      [member.id, member.name],
    )
  } else {
    // Fallback: no member record yet — show projects where user email matches lead
    rows = await all('SELECT * FROM projects WHERE LOWER(lead) = LOWER(?) ORDER BY id ASC', [userEmail])
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

router.post('/', asyncHandler(async (req, res) => {
  const { name, key, type, lead } = req.body
  const trimmedName = String(name || '').trim()
  const trimmedKey = String(key || '').trim()
  const trimmedType = String(type || 'Scrum').trim()
  const trimmedLead = String(lead || '').trim()

  if (!trimmedName || !trimmedKey || !trimmedType || !trimmedLead) {
    res.status(400).json({ error: 'name, key, type, and lead are required' })
    return
  }

  const result = await run(
    'INSERT INTO projects (name, key, type, lead) VALUES (?, ?, ?, ?)',
    [trimmedName, trimmedKey, trimmedType, trimmedLead],
  )
  const projectId = result.lastID

  // Auto-add the logged-in user as an Admin member of the new project
  const userEmail = req.user?.email
  if (userEmail) {
    const member = await get('SELECT id FROM members WHERE LOWER(email) = LOWER(?)', [userEmail])
    if (member) {
      await run(
        'INSERT OR IGNORE INTO project_members (project_id, member_id, role) VALUES (?, ?, ?)',
        [projectId, member.id, 'Admin'],
      )
    }
  }

  res.status(201).json({
    id: projectId,
    name: trimmedName,
    key: trimmedKey,
    type: trimmedType,
    lead: trimmedLead,
    avatar_color: '#0052cc',
  })
}))

router.put('/:id', asyncHandler(async (req, res) => {
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

  await run(
    'UPDATE projects SET name = ?, key = ?, type = ?, lead = ? WHERE id = ?',
    [updatedName, updatedKey, updatedType, updatedLead, id],
  )

  const updated = await get('SELECT * FROM projects WHERE id = ?', [id])
  res.json(updated)
}))

router.delete('/:id', asyncHandler(async (req, res) => {
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

router.post('/:id/members', asyncHandler(async (req, res) => {
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

router.delete('/:id/members/:memberId', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  const memberId = Number(req.params.memberId)
  await run(
    'DELETE FROM project_members WHERE project_id = ? AND member_id = ?',
    [projectId, memberId],
  )
  res.json({ ok: true })
}))

export default router
