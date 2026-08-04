// JL-336 — the dashboard legend links to /projects/:id/list?status=<status>, so
// the List page has to read that query parameter. It also has to WIN over the
// saved view ListViewControls auto-applies on load, otherwise the link would
// land on the list and be silently overwritten a tick later.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const ISSUES = [
  { id: 1, key: 'TP-1', title: 'Todo one',     status: 'To Do',       priority: 'Medium', issueType: 'Task',  assignee: 'Alice', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Todo two',     status: 'To Do',       priority: 'Medium', issueType: 'Task',  assignee: 'Alice', sprintId: null, projectId: 1 },
  { id: 3, key: 'TP-3', title: 'Progress one', status: 'In Progress', priority: 'High',   issueType: 'Bug',   assignee: 'Bob',   sprintId: null, projectId: 1 },
  { id: 4, key: 'TP-4', title: 'Done one',     status: 'Done',        priority: 'Low',    issueType: 'Story', assignee: 'Bob',   sprintId: null, projectId: 1 },
]

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: ISSUES, handleCreate: vi.fn(), handleMove: vi.fn(), handleUpdate: vi.fn(), handleDelete: vi.fn() }),
}))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { name: 'Alex Rivera', email: 'alex@test.com' } }),
}))
vi.mock('../context/MemberContext', () => ({ useMembers: () => ({ profile: { full_name: 'Alex Rivera' } }) }))

const fetchListViews = vi.fn().mockResolvedValue([])
vi.mock('../api/listViewApi', () => ({
  fetchListViews: (...args) => fetchListViews(...args),
  createListView: vi.fn(),
  updateListView: vi.fn(),
  deleteListView: vi.fn(),
  DEFAULT_COLUMNS: ['type', 'key', 'summary', 'status'],
  COLUMN_LABELS: { type: 'Type', key: 'Key', summary: 'Summary', status: 'Status' },
}))

import { IssueListPage } from '../pages/ListPage/IssueListPage'

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/list" element={<IssueListPage />} />
        <Route path="/projects/:projectId/list" element={<IssueListPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// Data rows only (skip group headers / the empty-state row).
function rowKeys() {
  return Array.from(document.querySelectorAll('.jira-list-table tbody .jira-list-key-link')).map((b) => b.textContent)
}

// The toolbar status <select>; row selects render their statuses upper-cased
// ("DONE"), so matching the mixed-case option text picks out the toolbar one.
const toolbarFilterValue = () => document.querySelector('.jira-list-toolbar select.jira-list-select').value

// A saved default view that would set a *different* status filter.
const DEFAULT_VIEW = {
  id: 11,
  name: 'My default',
  isDefault: true,
  columns: ['type', 'key', 'summary', 'status'],
  filterJql: JSON.stringify({ statusFilter: 'To Do', groupBy: 'none', sortKey: null, sortDir: 'asc' }),
}

describe('JL-336 — List page honours ?status= from the URL', () => {
  beforeEach(() => {
    fetchListViews.mockReset()
    fetchListViews.mockResolvedValue([])
  })

  it('applies the status filter on first render', () => {
    renderAt('/projects/1/list?status=Done')

    expect(rowKeys()).toEqual(['TP-4'])
    expect(toolbarFilterValue()).toBe('Done')
  })

  it('handles a space-encoded status', () => {
    renderAt('/projects/1/list?status=In%20Progress')

    expect(rowKeys()).toEqual(['TP-3'])
    expect(toolbarFilterValue()).toBe('In Progress')
  })

  it('works on the unscoped /list route too', () => {
    renderAt('/list?status=To%20Do')

    expect(rowKeys()).toEqual(['TP-1', 'TP-2'])
  })

  it('ignores a status the list cannot filter by, rather than emptying the list', () => {
    renderAt('/projects/1/list?status=Bogus')

    expect(rowKeys()).toHaveLength(4)
    expect(toolbarFilterValue()).toBe('All')
  })

  it('shows everything when no status param is present', () => {
    renderAt('/projects/1/list')

    expect(rowKeys()).toHaveLength(4)
    expect(toolbarFilterValue()).toBe('All')
  })

  it('still lets the user change the filter afterwards', () => {
    renderAt('/projects/1/list?status=Done')
    expect(rowKeys()).toEqual(['TP-4'])

    fireEvent.change(document.querySelector('.jira-list-toolbar select.jira-list-select'), {
      target: { value: 'In Progress' },
    })
    expect(rowKeys()).toEqual(['TP-3'])
  })
})

describe('JL-336 — the URL status beats the auto-applied default view', () => {
  beforeEach(() => {
    fetchListViews.mockReset()
    fetchListViews.mockResolvedValue([DEFAULT_VIEW])
  })

  it('keeps the URL status even after the default view loads', async () => {
    renderAt('/projects/1/list?status=Done')

    await waitFor(() => expect(fetchListViews).toHaveBeenCalled())
    // Give the default-view effect every chance to clobber the filter.
    await waitFor(() => expect(screen.getByText('Views')).toBeTruthy())

    expect(toolbarFilterValue()).toBe('Done')
    expect(rowKeys()).toEqual(['TP-4'])
  })

  it('still applies the default view\'s status when the URL says nothing', async () => {
    renderAt('/projects/1/list')

    await waitFor(() => expect(toolbarFilterValue()).toBe('To Do'))
    expect(rowKeys()).toEqual(['TP-1', 'TP-2'])
  })
})
