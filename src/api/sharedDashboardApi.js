import { api } from './client.js'

export const fetchSharedDashboards = () =>
  api('/api/shared-dashboards')

export const fetchSharedDashboard = (id) =>
  api(`/api/shared-dashboards/${id}`)

export const createSharedDashboard = (data) =>
  api('/api/shared-dashboards', { method: 'POST', body: JSON.stringify(data) })

export const updateSharedDashboard = (id, data) =>
  api(`/api/shared-dashboards/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deleteSharedDashboard = (id) =>
  api(`/api/shared-dashboards/${id}`, { method: 'DELETE' })

export const cloneSharedDashboard = (id) =>
  api(`/api/shared-dashboards/${id}/clone`, { method: 'POST' })
