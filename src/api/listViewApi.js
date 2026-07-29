import { api } from './client.js'

// Sensible default column set when the user has no saved view yet.
export const DEFAULT_COLUMNS = ['key', 'summary', 'status', 'priority', 'assignee', 'updated']

// Human-friendly labels for the known column keys (column picker UI).
export const COLUMN_LABELS = {
  key: 'Key',
  summary: 'Summary',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  reporter: 'Reporter',
  issueType: 'Type',
  labels: 'Labels',
  updated: 'Updated',
  created: 'Created',
  dueDate: 'Due date',
  storyPoints: 'Story points',
}

// List the current user's saved views. Pass a `projectId` to fetch views scoped
// to that project (List page, JL-255); omit it for global views (Filters page).
export const fetchListViews = (projectId) =>
  api(projectId != null && projectId !== '' ? `/api/list-views?projectId=${encodeURIComponent(projectId)}` : '/api/list-views')

// Fetch the allowed column catalog + defaults from the server
export const fetchColumnCatalog = () => api('/api/list-views/columns')

export function createListView({ name, columns, filterJql, isDefault, projectId }) {
  return api('/api/list-views', {
    method: 'POST',
    body: JSON.stringify({ name, columns, filterJql, isDefault, projectId }),
  })
}

export function updateListView(id, payload) {
  return api(`/api/list-views/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteListView(id) {
  return api(`/api/list-views/${id}`, { method: 'DELETE' })
}
