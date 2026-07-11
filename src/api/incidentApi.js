import { api } from './client.js'

// --- Incidents ---
export const fetchIncidents = (params = {}) => {
  const qs = new URLSearchParams()
  if (params.status) qs.set('status', params.status)
  if (params.severity) qs.set('severity', params.severity)
  const q = qs.toString()
  return api(`/api/incidents${q ? `?${q}` : ''}`)
}

export const fetchIncident = (id) => api(`/api/incidents/${id}`)

export const createIncident = (data) =>
  api('/api/incidents', { method: 'POST', body: JSON.stringify(data) })

export const updateIncident = (id, data) =>
  api(`/api/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const addTimelineEntry = (id, data) =>
  api(`/api/incidents/${id}/timeline`, { method: 'POST', body: JSON.stringify(data) })

// --- On-call ---
export const fetchSchedules = () => api('/api/oncall/schedules')

export const createSchedule = (data) =>
  api('/api/oncall/schedules', { method: 'POST', body: JSON.stringify(data) })

export const deleteSchedule = (id) =>
  api(`/api/oncall/schedules/${id}`, { method: 'DELETE' })

export const fetchShifts = (scheduleId) =>
  api(`/api/oncall/schedules/${scheduleId}/shifts`)

export const createShift = (scheduleId, data) =>
  api(`/api/oncall/schedules/${scheduleId}/shifts`, { method: 'POST', body: JSON.stringify(data) })

export const deleteShift = (id) =>
  api(`/api/oncall/shifts/${id}`, { method: 'DELETE' })

export const fetchCurrentOnCall = (scheduleId) =>
  api(`/api/oncall/current${scheduleId ? `?scheduleId=${scheduleId}` : ''}`)
