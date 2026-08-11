import { api } from './client.js'

// JL-330: Workflow Editor node layout. Previously localStorage-only, so a
// layout was per-device, lost on a cache clear, and invisible to teammates.
// The layout is a { statusName: { x, y } } map, one per project.

export const fetchWorkflowLayout = (projectId) =>
  api(`/api/projects/${projectId}/workflow-layout`)

// A full replace, not a merge — passing {} resets the layout.
export const saveWorkflowLayout = (projectId, positions) =>
  api(`/api/projects/${projectId}/workflow-layout`, {
    method: 'PUT',
    body: JSON.stringify({ positions }),
  })
