import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

const STATUSES = ['unreleased', 'released']
// Issues in this status are considered "resolved" for readiness / progress purposes.
const DONE_STATUS = 'Done'

function mapRelease(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description || '',
    releaseDate: row.release_date,
    status: row.status,
    createdAt: row.created_at,
    issueCount: row.issueCount !== undefined ? Number(row.issueCount) : undefined,
  }
}

// GET /api/projects/:projectId/releases — list releases (with issue counts). History = all releases.
router.get('/projects/:projectId/releases', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const rows = await all(
    `SELECT r.*, COUNT(i.id)::int AS "issueCount"
     FROM releases r
     LEFT JOIN issues i ON i.release_id = r.id
     WHERE r.project_id = ?
     GROUP BY r.id
     ORDER BY r.release_date DESC NULLS LAST, r.created_at DESC`,
    [projectId],
  )
  res.json(rows.map(mapRelease))
}))

// GET /api/releases/:id — a single release
router.get('/releases/:id', asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM releases WHERE id = ?', [Number(req.params.id)])
  if (!row) { res.status(404).json({ error: 'Release not found' }); return }
  res.json(mapRelease(row))
}))

// POST /api/projects/:projectId/releases (Member+) — create a release
router.post('/projects/:projectId/releases', requireRole('Member', 'Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const name = String(req.body?.name || '').trim()
  const description = String(req.body?.description || '').trim()
  const releaseDate = req.body?.releaseDate ? String(req.body.releaseDate).trim() : null
  const status = String(req.body?.status || 'unreleased').trim()

  if (!name) { res.status(400).json({ error: 'Release name is required' }); return }
  if (!STATUSES.includes(status)) { res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` }); return }

  const created = await run(
    'INSERT INTO releases (project_id, name, description, release_date, status) VALUES (?, ?, ?, ?, ?)',
    [projectId, name, description, releaseDate, status],
  )
  const row = await get('SELECT * FROM releases WHERE id = ?', [created.lastID])
  res.status(201).json(mapRelease(row))
}))

// PATCH /api/releases/:id (Member+) — update name/description/date/status
router.patch('/releases/:id', requireRole('Member', 'Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM releases WHERE id = ?', [id])
  if (!existing) { res.status(404).json({ error: 'Release not found' }); return }

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name
  const description = req.body?.description !== undefined ? String(req.body.description).trim() : existing.description
  const releaseDate = req.body?.releaseDate !== undefined
    ? (req.body.releaseDate ? String(req.body.releaseDate).trim() : null)
    : existing.release_date
  const status = req.body?.status !== undefined ? String(req.body.status).trim() : existing.status

  if (!name) { res.status(400).json({ error: 'Release name is required' }); return }
  if (!STATUSES.includes(status)) { res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` }); return }

  await run(
    'UPDATE releases SET name = ?, description = ?, release_date = ?, status = ? WHERE id = ?',
    [name, description, releaseDate, status, id],
  )
  const row = await get('SELECT * FROM releases WHERE id = ?', [id])
  res.json(mapRelease(row))
}))

// DELETE /api/releases/:id (Admin) — delete a release (issues.release_id set NULL via FK)
router.delete('/releases/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM releases WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

// PUT /api/issues/:issueId/release (Member+) — assign / unassign an issue to a release. Body: { releaseId }
router.put('/issues/:issueId/release', requireRole('Member', 'Admin'), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const releaseId = req.body?.releaseId === null || req.body?.releaseId === undefined || req.body.releaseId === ''
    ? null
    : Number(req.body.releaseId)

  const issue = await get('SELECT id, project_id FROM issues WHERE id = ?', [issueId])
  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return }

  if (releaseId !== null) {
    const release = await get('SELECT id, project_id FROM releases WHERE id = ?', [releaseId])
    if (!release) { res.status(404).json({ error: 'Release not found' }); return }
    if (release.project_id !== issue.project_id) {
      res.status(400).json({ error: 'Release and issue belong to different projects' }); return
    }
  }

  await run('UPDATE issues SET release_id = ? WHERE id = ?', [releaseId, issueId])
  res.json({ issueId, releaseId })
}))

// GET /api/releases/:id/issues — issues assigned to this release
router.get('/releases/:id/issues', asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT id, issue_key, title, issue_type, status, priority, assignee
     FROM issues WHERE release_id = ? ORDER BY issue_type ASC, id ASC`,
    [Number(req.params.id)],
  )
  res.json(rows)
}))

// GET /api/releases/:id/progress — status counts + resolved/unresolved + readiness (unresolved issues)
router.get('/releases/:id/progress', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const release = await get('SELECT * FROM releases WHERE id = ?', [id])
  if (!release) { res.status(404).json({ error: 'Release not found' }); return }

  const statusRows = await all(
    `SELECT status, COUNT(*)::int AS count FROM issues WHERE release_id = ? GROUP BY status`,
    [id],
  )
  const byStatus = {}
  let total = 0
  let done = 0
  for (const r of statusRows) {
    byStatus[r.status] = Number(r.count)
    total += Number(r.count)
    if (r.status === DONE_STATUS) done += Number(r.count)
  }
  const unresolved = await all(
    `SELECT id, issue_key, title, issue_type, status, assignee
     FROM issues WHERE release_id = ? AND status <> ? ORDER BY id ASC`,
    [id, DONE_STATUS],
  )
  const percentComplete = total === 0 ? 0 : Math.round((done / total) * 100)
  res.json({
    releaseId: id,
    total,
    done,
    unresolvedCount: total - done,
    percentComplete,
    byStatus,
    unresolvedIssues: unresolved,
    ready: total > 0 && unresolved.length === 0,
  })
}))

// GET /api/releases/:id/notes — auto-generated release notes grouped by issue type
router.get('/releases/:id/notes', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const release = await get('SELECT * FROM releases WHERE id = ?', [id])
  if (!release) { res.status(404).json({ error: 'Release not found' }); return }

  const rows = await all(
    `SELECT id, issue_key, title, issue_type, status
     FROM issues WHERE release_id = ? ORDER BY issue_type ASC, id ASC`,
    [id],
  )
  const groups = {}
  for (const r of rows) {
    const type = r.issue_type || 'Other'
    if (!groups[type]) groups[type] = []
    groups[type].push({ id: r.id, issueKey: r.issue_key, title: r.title, status: r.status })
  }
  res.json({
    release: mapRelease(release),
    totalIssues: rows.length,
    groups,
  })
}))

export default router
