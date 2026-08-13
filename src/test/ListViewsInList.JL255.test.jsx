// JL-255 — The List page must integrate the shared ListViewControls so users can
// save / load / switch named saved views (columns + filter/sort) persisted via
// /api/list-views, honoring the per-scope default view. These tests mock the
// listViewApi module and assert the wiring in IssueListPage.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Hoisted mocks for the saved-views API (ListViewControls imports these).
const mocks = vi.hoisted(() => ({
  fetchListViews: vi.fn(),
  createListView: vi.fn(),
  updateListView: vi.fn(),
  deleteListView: vi.fn(),
}))

vi.mock('../api/listViewApi', () => ({
  fetchListViews: mocks.fetchListViews,
  createListView: mocks.createListView,
  updateListView: mocks.updateListView,
  deleteListView: mocks.deleteListView,
  DEFAULT_COLUMNS: ['key', 'summary', 'status', 'priority', 'assignee', 'updated'],
  COLUMN_LABELS: { key: 'Key', summary: 'Summary', status: 'Status' },
}))

const ISSUES = [
  { id: 1, key: 'TP-1', title: 'Board a rocket', status: 'To Do', priority: 'High', issueType: 'Story', assignee: 'Al', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Refuel the rocket', status: 'In Progress', priority: 'Medium', issueType: 'Task', assignee: 'Bo', sprintId: null, projectId: 1 },
]

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: ISSUES, handleCreate: vi.fn(), handleMove: vi.fn(), handleUpdate: vi.fn(), handleDelete: vi.fn() }),
}))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ authUser: { name: 'Alex Rivera', email: 'alex@test.com' } }) }))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    profile: { full_name: 'Alex Rivera' },
    currentMember: { workspaceRole: 'Admin', isOwner: false, projectRoles: [], projectCreationPolicy: 'all_members' },
  }),
}))

import { IssueListPage } from '../pages/ListPage/IssueListPage'

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/list']}>
      <Routes>
        <Route path="/projects/:projectId/list" element={<IssueListPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchListViews.mockResolvedValue([])
})

describe('JL-255 — saved views wired into the List page', () => {
  it('renders the ListViewControls "Views" trigger and scopes the fetch to the project', async () => {
    renderList()
    expect(await screen.findByRole('button', { name: 'Views' })).toBeInTheDocument()
    // Views are loaded scoped to the current project (projectId from the route).
    await waitFor(() => expect(mocks.fetchListViews).toHaveBeenCalledWith('1'))
  })

  it('honors the default view on load — its columns replace the local column state', async () => {
    mocks.fetchListViews.mockResolvedValue([
      { id: 10, name: 'Compact default', columns: ['key', 'summary', 'status'], filterJql: null, isDefault: true, projectId: 1 },
    ])
    renderList()

    // Default view collapses the columns to just key/summary/status, so the
    // page's own default extra columns (Comments, Sprint) disappear.
    expect(await screen.findByRole('columnheader', { name: /Work/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('columnheader', { name: /Comments/i })).toBeNull()
      expect(screen.queryByRole('columnheader', { name: /Sprint/i })).toBeNull()
    })
  })

  it('saves the current columns + serialized filter/sort as a new view, scoped to the project', async () => {
    mocks.createListView.mockResolvedValue({ id: 30, name: 'My View', columns: [], filterJql: null, isDefault: false, projectId: 1 })
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: 'Views' }))
    const nameInput = await screen.findByPlaceholderText('Save current as…')
    fireEvent.change(nameInput, { target: { value: 'My View' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    await waitFor(() => expect(mocks.createListView).toHaveBeenCalledTimes(1))
    const payload = mocks.createListView.mock.calls[0][0]
    expect(payload.name).toBe('My View')
    // Persists this page's own column vocabulary (its current column order).
    // JL-397 moved the default set closer to Jira's "All issues" default, then
    // JL-398 collapsed its type/key/summary entries into the single Work column.
    // Still asserted exactly, so a further drift is caught.
    expect(payload.columns).toEqual(['work', 'status', 'assignee', 'priority', 'created'])
    expect(payload.projectId).toBe('1')
    // Filter + sort are serialized into filterJql.
    const parsed = JSON.parse(payload.filterJql)
    expect(parsed.statusFilter).toBe('All')
    expect(parsed.sortDir).toBe('asc')
  })

  it('switching to a saved view applies its columns and restores its saved filter', async () => {
    mocks.fetchListViews.mockResolvedValue([
      {
        id: 40,
        name: 'Done only',
        columns: ['key', 'summary'],
        filterJql: JSON.stringify({ statusFilter: 'Done', groupBy: 'none', sortKey: null, sortDir: 'asc' }),
        isDefault: false,
        projectId: 1,
      },
    ])
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: 'Views' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Done only' }))

    // Columns collapse to key/summary (Status header removed)...
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Work/i })).toBeInTheDocument()
      expect(screen.queryByRole('columnheader', { name: /Status/i })).toBeNull()
    })
    // ...and the saved status filter is restored on the toolbar filter select.
    expect(screen.getByDisplayValue('Done')).toBeInTheDocument()
  })
})
