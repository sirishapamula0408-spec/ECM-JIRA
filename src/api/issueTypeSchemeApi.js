import { api } from './client.js'

// JL-116: Issue-type schemes — which issue types a project exposes.

// Effective allowed types + default for a project (project scheme else global default).
export const fetchProjectIssueTypes = (projectId) =>
  api(`/api/projects/${projectId}/issue-types`)

// Admin-only: set the project's allowed types + default type.
export const setProjectIssueTypes = (projectId, { allowedTypes, defaultType }) =>
  api(`/api/projects/${projectId}/issue-types`, {
    method: 'PUT',
    body: JSON.stringify({ allowedTypes, defaultType }),
  })
