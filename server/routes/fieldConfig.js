import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

// Built-in issue field keys that may carry a field configuration. Custom fields
// use the 'custom:<id>' key form and are validated separately.
export const BUILTIN_FIELD_KEYS = [
  'title',
  'description',
  'assignee',
  'priority',
  'status',
  'issueType',
  'dueDate',
  'startDate',
  'resolution',
  'environment',
  'components',
  'storyPoints',
  'sprintId',
  'epicId',
  'reporter',
]

export function isValidFieldKey(key) {
  if (typeof key !== 'string' || !key.trim()) return false
  if (BUILTIN_FIELD_KEYS.includes(key)) return true
  return /^custom:\d+$/.test(key)
}

// Treat undefined / null / whitespace-only as "not provided" for required checks.
export function isEmptyValue(v) {
  return v === undefined || v === null || String(v).trim() === ''
}

function mapConfig(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    issueType: row.issue_type ?? null,
    fieldKey: row.field_key,
    isRequired: Boolean(row.is_required),
    isHidden: Boolean(row.is_hidden),
    defaultValue: row.default_value ?? null,
  }
}

/**
 * Load the field-configuration rows that apply to a given project + issue type
 * (rows with a NULL issue_type apply to every type). The loader is injectable so
 * the pure logic can be unit-tested without a live/mocked db module.
 */
export async function loadFieldConfigs(projectId, issueType, load = all) {
  const rows = await load(
    `SELECT id, project_id, issue_type, field_key, is_required, is_hidden, default_value
     FROM field_configurations
     WHERE project_id = ? AND (issue_type IS NULL OR issue_type = ?)
     ORDER BY id ASC`,
    [projectId, issueType ?? null],
  )
  return Array.isArray(rows) ? rows : []
}

/**
 * Return the list of required field keys that are missing from `providedFields`.
 * Backward compatible: returns [] when there is no project id or no config rows.
 * Hidden fields are not enforced as required (the user can't supply them).
 *
 * @param {number|null} projectId
 * @param {string} issueType
 * @param {Record<string, unknown>} providedFields  map of field_key -> value
 * @param {Function} [load]  optional loader (defaults to db.all) for isolated tests
 * @returns {Promise<string[]>} missing required field keys
 */
export async function validateRequiredFields(projectId, issueType, providedFields = {}, load = all) {
  if (!projectId) return []
  const rows = await loadFieldConfigs(projectId, issueType, load)
  const missing = []
  for (const row of rows) {
    if (!row.is_required || row.is_hidden) continue
    if (isEmptyValue(providedFields?.[row.field_key])) missing.push(row.field_key)
  }
  return missing
}

// GET /api/projects/:id/field-config — list all field configs for a project
router.get('/projects/:id/field-config', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  const rows = await all(
    'SELECT id, project_id, issue_type, field_key, is_required, is_hidden, default_value FROM field_configurations WHERE project_id = ? ORDER BY id ASC',
    [projectId],
  )
  res.json((rows || []).map(mapConfig))
}))

// PUT /api/projects/:id/field-config — upsert the full list (Admin only).
// Body: array of { field_key, issue_type, is_required, is_hidden, default_value }
// (camelCase aliases accepted), or { fields: [...] }.
router.put('/projects/:id/field-config', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  const items = Array.isArray(req.body)
    ? req.body
    : Array.isArray(req.body?.fields)
      ? req.body.fields
      : null
  if (!items) {
    res.status(400).json({ error: 'Body must be an array of field configs (or { fields: [...] })' })
    return
  }

  const normalized = []
  const seen = new Set()
  for (const item of items) {
    const fieldKey = String(item?.field_key ?? item?.fieldKey ?? '').trim()
    if (!isValidFieldKey(fieldKey)) {
      res.status(400).json({ error: `Invalid field_key: ${fieldKey || '(empty)'}` })
      return
    }
    const rawType = item?.issue_type ?? item?.issueType
    const issueType =
      rawType === undefined || rawType === null || String(rawType).trim() === ''
        ? null
        : String(rawType).trim()
    // De-dupe on the same unique key the DB index enforces.
    const dedupeKey = `${issueType ?? ''}|${fieldKey}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const rawDefault = item?.default_value ?? item?.defaultValue
    normalized.push({
      fieldKey,
      issueType,
      isRequired: Boolean(item?.is_required ?? item?.isRequired ?? false),
      isHidden: Boolean(item?.is_hidden ?? item?.isHidden ?? false),
      defaultValue:
        rawDefault === undefined || rawDefault === null || String(rawDefault) === ''
          ? null
          : String(rawDefault),
    })
  }

  // Replace-the-list upsert: clear existing rows, then insert the new set.
  await run('DELETE FROM field_configurations WHERE project_id = ?', [projectId])
  for (const n of normalized) {
    await run(
      'INSERT INTO field_configurations (project_id, issue_type, field_key, is_required, is_hidden, default_value) VALUES (?, ?, ?, ?, ?, ?)',
      [projectId, n.issueType, n.fieldKey, n.isRequired, n.isHidden, n.defaultValue],
    )
  }

  const rows = await all(
    'SELECT id, project_id, issue_type, field_key, is_required, is_hidden, default_value FROM field_configurations WHERE project_id = ? ORDER BY id ASC',
    [projectId],
  )
  res.json((rows || []).map(mapConfig))
}))

export default router
