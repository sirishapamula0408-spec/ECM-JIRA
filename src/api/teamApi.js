import { api } from './client.js'

// JL-419 — Atlassian-style teams. Note these are TEAMS, not the `/teams` page,
// which is the workspace member directory (see JL-417 / JL-425).

// `search` is passed to the SERVER, not applied to a downloaded list: the
// existing member directory filters client-side and JL-417 recorded that as a
// problem to fix, not a pattern to copy (JL-431).
export const fetchTeams = (search) => {
  const query = search ? `?search=${encodeURIComponent(search)}` : ''
  return api(`/api/teams${query}`)
}

export const fetchTeam = (teamId) => api(`/api/teams/${teamId}`)

export const createTeam = ({ name, description, membership }) =>
  api('/api/teams', {
    method: 'POST',
    body: JSON.stringify({ name, description, membership }),
  })

export const updateTeam = (teamId, patch) =>
  api(`/api/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const deleteTeam = (teamId) =>
  api(`/api/teams/${teamId}`, { method: 'DELETE' })

// Membership
export const fetchTeamMembers = (teamId) => api(`/api/teams/${teamId}/members`)

export const addTeamMember = (teamId, memberId, role) =>
  api(`/api/teams/${teamId}/members`, {
    method: 'POST',
    body: JSON.stringify({ memberId, role }),
  })

export const updateTeamMemberRole = (teamId, memberId, role) =>
  api(`/api/teams/${teamId}/members/${memberId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })

export const removeTeamMember = (teamId, memberId) =>
  api(`/api/teams/${teamId}/members/${memberId}`, { method: 'DELETE' })

// Links — the 10-cap is enforced by the server (JL-429); the UI explains it.
export const fetchTeamLinks = (teamId) => api(`/api/teams/${teamId}/links`)

export const addTeamLink = (teamId, { label, url }) =>
  api(`/api/teams/${teamId}/links`, {
    method: 'POST',
    body: JSON.stringify({ label, url }),
  })

export const removeTeamLink = (teamId, linkId) =>
  api(`/api/teams/${teamId}/links/${linkId}`, { method: 'DELETE' })

// Photo upload — base64-over-JSON through the SAME storage service attachments
// use (see src/api/attachmentApi.js). There is deliberately no second upload path.
export function uploadTeamAvatar(teamId, file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataBase64 = String(reader.result).split(',')[1] || ''
      api(`/api/teams/${teamId}/avatar`, {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mime: file.type || 'application/octet-stream',
          dataBase64,
        }),
      }).then(resolve).catch(reject)
    }
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

// JL-424 — team <-> project association. VISIBILITY AND NAVIGATION ONLY: being
// on a team grants no project access, and the server does not treat it as if it
// did. See the comment in server/routes/teams.js.
export const fetchTeamProjects = (teamId) => api(`/api/teams/${teamId}/projects`)

export const addTeamProject = (teamId, projectId) =>
  api(`/api/teams/${teamId}/projects`, {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  })

export const removeTeamProject = (teamId, projectId) =>
  api(`/api/teams/${teamId}/projects/${projectId}`, { method: 'DELETE' })

export const fetchProjectTeams = (projectId) => api(`/api/projects/${projectId}/teams`)

export const addProjectTeam = (projectId, teamId) =>
  api(`/api/projects/${projectId}/teams`, {
    method: 'POST',
    body: JSON.stringify({ teamId }),
  })

export const removeProjectTeam = (projectId, teamId) =>
  api(`/api/projects/${projectId}/teams/${teamId}`, { method: 'DELETE' })
