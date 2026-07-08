import { api } from './client.js'

// JL-79: Configurable workflow transitions (per project)
export const fetchWorkflowTransitions = (projectId) =>
  api(`/api/projects/${projectId}/workflow-transitions`)

export const createWorkflowTransition = (projectId, body) =>
  api(`/api/projects/${projectId}/workflow-transitions`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateWorkflowTransition = (id, body) =>
  api(`/api/workflow-transitions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

export const deleteWorkflowTransition = (id) =>
  api(`/api/workflow-transitions/${id}`, { method: 'DELETE' })
