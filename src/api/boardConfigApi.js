import { api } from './client.js'

// JL-85: Board configuration (swimlanes, quick filters, WIP limits) per project.

export const fetchBoardConfig = (projectId) =>
  api(`/api/projects/${projectId}/board-config`)

export const saveBoardConfig = (projectId, { swimlaneBy, wipLimits, quickFilters, estimationStatistic }) =>
  api(`/api/projects/${projectId}/board-config`, {
    method: 'PUT',
    body: JSON.stringify({ swimlaneBy, wipLimits, quickFilters, estimationStatistic }),
  })

// JL-126: estimation totals (per sprint + backlog) using the board's
// configured estimation statistic (story points / time estimate / issue count).
export const fetchEstimationSummary = (projectId) =>
  api(`/api/projects/${projectId}/estimation-summary`)

export const ESTIMATION_STATISTIC_OPTIONS = [
  { value: 'story_points', label: 'Story Points' },
  { value: 'time_estimate', label: 'Original Time Estimate' },
  { value: 'issue_count', label: 'Issue Count' },
]
