import { api } from './client.js'

// ── Permission schemes ──
export const fetchPermissionSchemes = () =>
  api('/api/schemes/permission')

export const fetchPermissionScheme = (id) =>
  api(`/api/schemes/permission/${id}`)

export const createPermissionScheme = (data) =>
  api('/api/schemes/permission', { method: 'POST', body: JSON.stringify(data) })

export const updatePermissionScheme = (id, patch) =>
  api(`/api/schemes/permission/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const deletePermissionScheme = (id) =>
  api(`/api/schemes/permission/${id}`, { method: 'DELETE' })

export const addPermissionGrant = (schemeId, { permissionKey, role }) =>
  api(`/api/schemes/permission/${schemeId}/grants`, { method: 'POST', body: JSON.stringify({ permissionKey, role }) })

export const deletePermissionGrant = (grantId) =>
  api(`/api/schemes/permission/grants/${grantId}`, { method: 'DELETE' })

// ── Notification schemes ──
export const fetchNotificationSchemes = () =>
  api('/api/schemes/notification')

export const fetchNotificationScheme = (id) =>
  api(`/api/schemes/notification/${id}`)

export const createNotificationScheme = (data) =>
  api('/api/schemes/notification', { method: 'POST', body: JSON.stringify(data) })

export const addNotificationRule = (schemeId, { eventKey, notifyRole }) =>
  api(`/api/schemes/notification/${schemeId}/rules`, { method: 'POST', body: JSON.stringify({ eventKey, notifyRole }) })

export const deleteNotificationRule = (ruleId) =>
  api(`/api/schemes/notification/rules/${ruleId}`, { method: 'DELETE' })

// ── Project assignment + effective permissions ──
export const assignPermissionScheme = (projectId, schemeId) =>
  api(`/api/projects/${projectId}/permission-scheme`, { method: 'PUT', body: JSON.stringify({ schemeId }) })

export const assignNotificationScheme = (projectId, schemeId) =>
  api(`/api/projects/${projectId}/notification-scheme`, { method: 'PUT', body: JSON.stringify({ schemeId }) })

export const fetchEffectivePermissions = (projectId) =>
  api(`/api/projects/${projectId}/effective-permissions`)

export const PERMISSION_KEYS = [
  'issue.create',
  'issue.edit',
  'issue.delete',
  'comment.add',
  'sprints.manage',
  'project.settings',
  'members.manage',
  'workflows.edit',
]

export const SCHEME_ROLES = ['Viewer', 'Member', 'Admin']
