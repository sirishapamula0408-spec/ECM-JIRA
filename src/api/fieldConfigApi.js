import { api } from './client.js'

// JL-115: Field configuration schemes (required / hidden / default per field)
export const fetchFieldConfig = (projectId) =>
  api(`/api/projects/${projectId}/field-config`)

// fields: array of { field_key, issue_type, is_required, is_hidden, default_value }
export const saveFieldConfig = (projectId, fields) =>
  api(`/api/projects/${projectId}/field-config`, {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  })
