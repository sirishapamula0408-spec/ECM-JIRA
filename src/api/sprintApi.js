import { api } from './client.js'

export const fetchSprints = () => api('/api/sprints')

export function createSprint(payload = {}) {
  return api('/api/sprints', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function startSprint(id) {
  return api(`/api/sprints/${id}/start`, {
    method: 'PATCH',
  })
}

export function updateSprint(id, payload) {
  return api(`/api/sprints/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function completeSprint(id) {
  return api(`/api/sprints/${id}/complete`, {
    method: 'PATCH',
  })
}

export function deleteSprint(id) {
  return api(`/api/sprints/${id}`, {
    method: 'DELETE',
  })
}
