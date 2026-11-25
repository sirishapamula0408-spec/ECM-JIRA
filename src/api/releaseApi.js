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

// JL-112: Fix/Affects versions (multiple typed versions per issue)
export const fetchIssueVersions = (issueId) =>
  api(`/api/issues/${issueId}/versions`)

export const setIssueVersions = (issueId, { fix, affects }) =>
  api(`/api/issues/${issueId}/versions`, {
    method: 'PUT',
    body: JSON.stringify({ fix, affects }),
  })

// JL-489: the Release Monitor's Pass / Fail on a work item in Release.
// body: { verdict: 'pass' | 'fail', reason?, moveToReleaseId? }
export const submitReleaseVerdict = (issueId, body) =>
  api(`/api/issues/${issueId}/release-verdict`, { method: 'POST', body: JSON.stringify(body) })

// Progress / readiness / release notes
export const fetchReleaseProgress = (releaseId) =>
  api(`/api/releases/${releaseId}/progress`)

export const fetchReleaseNotes = (releaseId) =>
  api(`/api/releases/${releaseId}/notes`)

// JL-488: release check (run automatically when a release is marked Released)
export const fetchReleaseCheck = (releaseId) =>
  api(`/api/releases/${releaseId}/check`)

export const runReleaseCheck = (releaseId) =>
  api(`/api/releases/${releaseId}/check`, { method: 'POST' })
