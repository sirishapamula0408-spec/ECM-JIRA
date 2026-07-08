import { api } from './client.js'

// Project-scoped release catalog / history
export const fetchProjectReleases = (projectId) =>
  api(`/api/projects/${projectId}/releases`)

export const fetchRelease = (releaseId) =>
  api(`/api/releases/${releaseId}`)

export const createRelease = (projectId, { name, description, releaseDate, status }) =>
  api(`/api/projects/${projectId}/releases`, {
    method: 'POST',
    body: JSON.stringify({ name, description, releaseDate, status }),
  })

export const updateRelease = (releaseId, patch) =>
  api(`/api/releases/${releaseId}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const deleteRelease = (releaseId) =>
  api(`/api/releases/${releaseId}`, { method: 'DELETE' })

// Issue assignment
export const assignIssueRelease = (issueId, releaseId) =>
  api(`/api/issues/${issueId}/release`, { method: 'PUT', body: JSON.stringify({ releaseId }) })

export const fetchReleaseIssues = (releaseId) =>
  api(`/api/releases/${releaseId}/issues`)

// Progress / readiness / release notes
export const fetchReleaseProgress = (releaseId) =>
  api(`/api/releases/${releaseId}/progress`)

export const fetchReleaseNotes = (releaseId) =>
  api(`/api/releases/${releaseId}/notes`)
