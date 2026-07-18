import { api } from './client.js'

export const fetchProjects = ({ includeArchived = false } = {}) =>
  api(`/api/projects${includeArchived ? '?includeArchived=true' : ''}`)

export const fetchProjectById = (id) => api(`/api/projects/${id}`)

// JL-219: non-destructive archive / restore (project Admin only)
export function archiveProject(id) {
  return api(`/api/projects/${id}/archive`, { method: 'POST' })
}

export function unarchiveProject(id) {
  return api(`/api/projects/${id}/unarchive`, { method: 'POST' })
}

export function createProject(payload) {
  return api('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateProject(id, payload) {
  return api(`/api/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteProject(id) {
  return api(`/api/projects/${id}`, { method: 'DELETE' })
}

export const fetchProjectMembers = (projectId) =>
  api(`/api/projects/${projectId}/members`)

export function addProjectMember(projectId, { memberId, role }) {
  return api(`/api/projects/${projectId}/members`, {
    method: 'POST',
    body: JSON.stringify({ memberId, role }),
  })
}

export function updateProjectMemberRole(projectId, memberId, role) {
  return api(`/api/projects/${projectId}/members/${memberId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

export function removeProjectMember(projectId, memberId) {
  return api(`/api/projects/${projectId}/members/${memberId}`, {
    method: 'DELETE',
  })
}
