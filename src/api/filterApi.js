import { api } from './client.js'

export const fetchFilters = () => api('/api/filters')

export function createFilter(payload) {
  return api('/api/filters', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateFilter(id, payload) {
  return api(`/api/filters/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteFilter(id) {
  return api(`/api/filters/${id}`, { method: 'DELETE' })
}

export function searchIssues(criteria) {
  return api('/api/filters/search', {
    method: 'POST',
    body: JSON.stringify(criteria),
  })
}

export function searchByJql(jql) {
  return api('/api/filters/jql', {
    method: 'POST',
    body: JSON.stringify({ jql }),
  })
}

export function aiSearch(query) {
  return api('/api/filters/ai-search', {
    method: 'POST',
    body: JSON.stringify({ query }),
  })
}
