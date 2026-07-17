import { api } from './client.js'

// List all screen schemes for a project, grouped by issue type (Admin only).
export const fetchScreenSchemes = (projectId) =>
  api(`/api/projects/${projectId}/screen-schemes`)

// Replace the ordered field list for one issue type (Admin only).
// fields: [{ fieldKey, showOnCreate, showOnEdit }] — order is significant.
export const saveScreenScheme = (projectId, issueType, fields) =>
  api(`/api/projects/${projectId}/screen-schemes/${encodeURIComponent(issueType)}`, {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  })

// The effective ordered field list for an issue type (falls back to all fields).
export const fetchResolvedScreen = (projectId, issueType) =>
  api(`/api/projects/${projectId}/screen-schemes/${encodeURIComponent(issueType)}/resolved`)
