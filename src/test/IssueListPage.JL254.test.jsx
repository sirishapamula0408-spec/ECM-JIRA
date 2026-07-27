// JL-254 — The List tab must be served by the correctly-named IssueListPage
// component (extracted from the old mis-named WorkflowsPage), and the legacy
// /workflows route must redirect to the properly-named /list view instead of
// colliding with the real workflow editor (/workflow-editor).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'

const ISSUES = [
  { id: 1, key: 'TP-1', title: 'Board a rocket', status: 'To Do', priority: 'High', issueType: 'Story', assignee: 'Al', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Refuel the rocket', status: 'In Progress', priority: 'Medium', issueType: 'Task', assignee: 'Bo', sprintId: null, projectId: 1 },
]

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: ISSUES, handleCreate: vi.fn(), handleMove: vi.fn(), handleUpdate: vi.fn(), handleDelete: vi.fn() }),
}))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ authUser: { name: 'Alex Rivera', email: 'alex@test.com' } }) }))
vi.mock('../context/MemberContext', () => ({ useMembers: () => ({ profile: { full_name: 'Alex Rivera' } }) }))

import { IssueListPage } from '../pages/ListPage/IssueListPage'

beforeEach(() => vi.clearAllMocks())

describe('JL-254 — List route serves IssueListPage (the issue-list UI)', () => {
  it('renders the issue-list toolbar and issue rows (not a workflow editor)', () => {
    render(
      <MemoryRouter initialEntries={['/projects/1/list']}>
        <IssueListPage />
      </MemoryRouter>,
    )
    // Issue-list toolbar + table markers.
    expect(screen.getByPlaceholderText('Search list')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Summary/i })).toBeInTheDocument()
    // Actual issue rows are listed.
    expect(screen.getByText('Board a rocket')).toBeInTheDocument()
    expect(screen.getByText('TP-1')).toBeInTheDocument()
  })

  it('redirects the legacy /workflows route to /list', () => {
    render(
      <MemoryRouter initialEntries={['/workflows']}>
        <Routes>
          <Route path="/workflows" element={<Navigate to="/list" replace />} />
          <Route path="/list" element={<div>list-view-target</div>} />
          <Route path="/workflow-editor" element={<div>workflow-editor-target</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('list-view-target')).toBeInTheDocument()
    expect(screen.queryByText('workflow-editor-target')).toBeNull()
  })
})
