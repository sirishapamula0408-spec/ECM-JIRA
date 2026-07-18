import { api } from './client.js'

// JL-73: Multi-workspace foundation — client for the workspace management API.

export const WORKSPACE_STORAGE_KEY = 'jira_active_workspace_id'

/** Read the selected workspace id from localStorage (or null). */
export function getActiveWorkspaceId() {
  try {
    return window.localStorage.getItem(WORKSPACE_STORAGE_KEY) || null
  } catch {
    return null
  }
}

/** Persist the selected workspace id (send as X-Workspace-Id by the api client). */
export function setActiveWorkspaceId(id) {
  try {
    if (id) window.localStorage.setItem(WORKSPACE_STORAGE_KEY, String(id))
    else window.localStorage.removeItem(WORKSPACE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export const fetchWorkspaces = () => api('/api/workspaces')

export const fetchCurrentWorkspace = () => api('/api/workspaces/current')

export const fetchWorkspace = (id) => api(`/api/workspaces/${id}`)

export const createWorkspace = (name) =>
  api('/api/workspaces', { method: 'POST', body: JSON.stringify({ name }) })

export const addWorkspaceMember = (id, email, role = 'Member') =>
  api(`/api/workspaces/${id}/members`, { method: 'POST', body: JSON.stringify({ email, role }) })

// JL-211: configurable workspace settings (project creation policy, etc.)

/** Read workspace-wide settings (any signed-in user). */
export const fetchWorkspaceSettings = () => api('/api/workspace/settings')

/** Update the project creation policy (Admin/Owner only). */
export const updateProjectCreationPolicy = (policy) =>
  api('/api/workspace/settings', {
    method: 'PUT',
    body: JSON.stringify({ project_creation_policy: policy }),
  })
