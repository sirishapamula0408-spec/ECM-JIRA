import { api } from './client.js'

// JL-125: Advanced Roadmap — epics across projects with dependencies + capacity.

export const fetchAdvancedRoadmap = (projectIds = []) => {
  const qs = projectIds.length ? `?projectIds=${projectIds.join(',')}` : ''
  return api(`/api/advanced-roadmap${qs}`)
}

// Dependencies
export const fetchDependencies = () => api('/api/roadmap-dependencies')

export const createDependency = ({ fromEpicId, toEpicId, type }) =>
  api('/api/roadmap-dependencies', {
    method: 'POST',
    body: JSON.stringify({ fromEpicId, toEpicId, type }),
  })

export const deleteDependency = (id) =>
  api(`/api/roadmap-dependencies/${id}`, { method: 'DELETE' })

// Team capacity
export const fetchTeamCapacity = (projectIds = []) => {
  const qs = projectIds.length ? `?projectIds=${projectIds.join(',')}` : ''
  return api(`/api/team-capacity${qs}`)
}

export const createTeamCapacity = ({ teamName, projectId, capacityPoints, periodStart, periodEnd }) =>
  api('/api/team-capacity', {
    method: 'POST',
    body: JSON.stringify({ teamName, projectId, capacityPoints, periodStart, periodEnd }),
  })

export const deleteTeamCapacity = (id) =>
  api(`/api/team-capacity/${id}`, { method: 'DELETE' })
