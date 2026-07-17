import { api } from './client.js'

// JL-159: Star / favorite projects
export const fetchFavorites = () => api('/api/favorites')

export function favoriteProject(projectId) {
  return api(`/api/projects/${projectId}/favorite`, { method: 'POST' })
}

export function unfavoriteProject(projectId) {
  return api(`/api/projects/${projectId}/favorite`, { method: 'DELETE' })
}
