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

// List the current user's saved views
export const fetchListViews = () => api('/api/list-views')

// Fetch the allowed column catalog + defaults from the server
export const fetchColumnCatalog = () => api('/api/list-views/columns')

export function createListView({ name, columns, filterJql, isDefault }) {
  return api('/api/list-views', {
    method: 'POST',
    body: JSON.stringify({ name, columns, filterJql, isDefault }),
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
