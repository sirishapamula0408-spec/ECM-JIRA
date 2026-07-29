import { api } from './client.js'

// JL-306: Named workflow definitions + built-in templates (QA Lifecycle).

export const fetchWorkflowTemplates = () => api('/api/workflow-templates')

export const fetchWorkflowDefinitions = (projectId) =>
  api(`/api/projects/${projectId}/workflow-definitions`)

export const applyWorkflowTemplate = (projectId, template) =>
  api(`/api/projects/${projectId}/workflow-definitions/apply-template`, {
    method: 'POST',
    body: JSON.stringify({ template }),
  })

export const createWorkflowDefinition = (projectId, body) =>
  api(`/api/projects/${projectId}/workflow-definitions`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateWorkflowDefinition = (id, body) =>
  api(`/api/workflow-definitions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

export const deleteWorkflowDefinition = (id) =>
  api(`/api/workflow-definitions/${id}`, { method: 'DELETE' })
