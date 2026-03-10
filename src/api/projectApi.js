import { api } from './client.js'

export const fetchProjects = () => api('/api/projects')

export const fetchProjectById = (id) => api(`/api/projects/${id}`)

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

export function removeProjectMember(projectId, memberId) {
  return api(`/api/projects/${projectId}/members/${memberId}`, {
    method: 'DELETE',
  })
}

export function updateProjectMemberRole(projectId, memberId, role) {
  return api(`/api/projects/${projectId}/members/${memberId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  })
}
