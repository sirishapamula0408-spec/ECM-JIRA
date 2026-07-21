import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireProjectRead, requireProjectWrite } from '../middleware/authorize.js'
import { sendError } from '../utils/httpError.js' // JL-181: canonical { error } shape

const router = Router()

// JL-226: project-access resolvers for the write guard. Creating a link acts on
// the source issue's project; DELETE is keyed by link id, so hop link → source
// issue → project.
const linkSourceProject = async (req) => {
  const issueId = Number(req.params.issueId)
  if (!Number.isInteger(issueId)) return null
  const row = await get('SELECT project_id FROM issues WHERE id = ?', [issueId])
  return row?.project_id ?? null
}
const linkIdProject = async (req) => {
  const link = await get('SELECT source_issue_id FROM issue_links WHERE id = ?', [Number(req.params.id)])
  if (!link) return null
  const row = await get('SELECT project_id FROM issues WHERE id = ?', [link.source_issue_id])
  return row?.project_id ?? null
}

// Directed link types stored on the source row, with their inverse (shown on the target)
const INVERSE = {
  'blocks': 'is blocked by',
  'is blocked by': 'blocks',
  'duplicates': 'is duplicated by',
  'is duplicated by': 'duplicates',
  'relates to': 'relates to',
}
export const LINK_TYPES = Object.keys(INVERSE)

const issueBrief = (row, alias) => ({
  id: row[`${alias}_id`],
  key: row[`${alias}_key`],
  title: row[`${alias}_title`],
  status: row[`${alias}_status`],
  issueType: row[`${alias}_type`],
})

// GET /api/issues/:issueId/links — links in both directions, from this issue's perspective
router.get('/issues/:issueId/links', requireProjectRead(linkSourceProject), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const rows = await all(
    `SELECT il.id, il.link_type, il.source_issue_id, il.target_issue_id,
            s.issue_key AS source_key, s.title AS source_title, s.status AS source_status, s.issue_type AS source_type, s.id AS source_id,
            t.issue_key AS target_key, t.title AS target_title, t.status AS target_status, t.issue_type AS target_type, t.id AS target_id
     FROM issue_links il
     JOIN issues s ON s.id = il.source_issue_id
     JOIN issues t ON t.id = il.target_issue_id
     WHERE il.source_issue_id = ? OR il.target_issue_id = ?
     ORDER BY il.created_at ASC`,
    [issueId, issueId],
  )
  const links = rows.map((r) => {
    const outgoing = r.source_issue_id === issueId
    return {
      id: r.id,
      type: outgoing ? r.link_type : INVERSE[r.link_type] || r.link_type,
      issue: outgoing ? issueBrief(r, 'target') : issueBrief(r, 'source'),
    }
  })
  res.json(links)
}))

// POST /api/issues/:issueId/links — { type, targetIssueId }
router.post('/issues/:issueId/links', requireProjectWrite(linkSourceProject), asyncHandler(async (req, res) => {
  const sourceId = Number(req.params.issueId)
  const type = String(req.body?.type || '').trim()
  const targetIssueId = Number(req.body?.targetIssueId)

  if (!LINK_TYPES.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${LINK_TYPES.join(', ')}` })
    return
  }
  if (!Number.isInteger(targetIssueId) || targetIssueId === sourceId) {
    return sendError(res, 400, 'A valid target issue (other than this one) is required')
  }
  const target = await get('SELECT id FROM issues WHERE id = ?', [targetIssueId])
  if (!target) { res.status(404).json({ error: 'Target issue not found' }); return }

  // Prevent duplicate links in either direction for the same relationship
  const existing = await get(
    `SELECT id FROM issue_links
     WHERE (source_issue_id = ? AND target_issue_id = ? AND link_type = ?)
        OR (source_issue_id = ? AND target_issue_id = ? AND link_type = ?)`,
    [sourceId, targetIssueId, type, targetIssueId, sourceId, INVERSE[type]],
  )
  if (existing) { res.status(409).json({ error: 'This link already exists' }); return }

  const created = await run(
    'INSERT INTO issue_links (source_issue_id, target_issue_id, link_type) VALUES (?, ?, ?)',
    [sourceId, targetIssueId, type],
  )
  res.status(201).json({ id: created.lastID, type, sourceId, targetIssueId })
}))

// DELETE /api/links/:id
router.delete('/links/:id', requireProjectWrite(linkIdProject), asyncHandler(async (req, res) => {
  await run('DELETE FROM issue_links WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

export default router
