import { api } from './client.js'

export const fetchSprints = () => api('/api/sprints')

export function createSprint(payload = {}) {
  return api('/api/sprints', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function startSprint(id, projectId) {
  return api(`/api/sprints/${id}/start`, {
    method: 'PATCH',
    body: JSON.stringify(projectId != null ? { projectId } : {}),
  })
}

// JL-124: parallel (concurrent) active sprints
export const fetchActiveSprints = (projectId) => api(`/api/projects/${projectId}/sprints/active`)

export const fetchParallelSprintSetting = (projectId) =>
  api(`/api/projects/${projectId}/sprints/settings`)

export function setParallelSprintSetting(projectId, allowParallelSprints) {
  return api(`/api/projects/${projectId}/sprints/settings`, {
    method: 'PUT',
    body: JSON.stringify({ allowParallelSprints }),
  })
}

export function updateSprint(id, payload) {
  return api(`/api/sprints/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function completeSprint(id) {
  return api(`/api/sprints/${id}/complete`, {
    method: 'PATCH',
  })
}

export function deleteSprint(id) {
  return api(`/api/sprints/${id}`, {
    method: 'DELETE',
  })
}

// JL-127: Sprint retrospectives
export const fetchRetros = (sprintId) => api(`/api/sprints/${sprintId}/retros`)

export function addRetro(sprintId, payload) {
  return api(`/api/sprints/${sprintId}/retros`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteRetro(sprintId, retroId) {
  return api(`/api/sprints/${sprintId}/retros/${retroId}`, {
    method: 'DELETE',
  })
}

// JL-127: Sprint templates
export const fetchSprintTemplates = () => api('/api/sprint-templates')

export function createSprintTemplate(payload = {}) {
  return api('/api/sprint-templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function createSprintFromTemplate(templateId, payload = {}) {
  return api(`/api/sprint-templates/${templateId}/create-sprint`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
