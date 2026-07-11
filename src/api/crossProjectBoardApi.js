import { api } from './client.js'

export const fetchCrossProjectBoards = () =>
  api('/api/cross-project-boards')

export const fetchCrossProjectBoard = (id) =>
  api(`/api/cross-project-boards/${id}`)

export const createCrossProjectBoard = (data) =>
  api('/api/cross-project-boards', { method: 'POST', body: JSON.stringify(data) })

export const updateCrossProjectBoard = (id, data) =>
  api(`/api/cross-project-boards/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deleteCrossProjectBoard = (id) =>
  api(`/api/cross-project-boards/${id}`, { method: 'DELETE' })

export const fetchCrossProjectBoardIssues = (id) =>
  api(`/api/cross-project-boards/${id}/issues`)
