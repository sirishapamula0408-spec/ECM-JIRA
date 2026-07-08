import { api } from './client.js'

// JL-85: Board configuration (swimlanes, quick filters, WIP limits) per project.

export const fetchBoardConfig = (projectId) =>
  api(`/api/projects/${projectId}/board-config`)

export const saveBoardConfig = (projectId, { swimlaneBy, wipLimits, quickFilters }) =>
  api(`/api/projects/${projectId}/board-config`, {
    method: 'PUT',
    body: JSON.stringify({ swimlaneBy, wipLimits, quickFilters }),
  })
