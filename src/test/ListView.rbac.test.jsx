// JL-294 — RBAC: the List view (WorkflowsPage.jsx, served at /workflows and
// /projects/:id/list) must not show write controls to Viewers. Row selection
// checkboxes, the bulk Status/Priority/Delete bar, and the inline "+ Create"
// row are gated by usePermissions(projectId) (canEditIssue / canDeleteIssue /
// canCreateIssue). Reads — the list itself, sorting, grouping, filtering, and
// navigation to an issue — stay fully available to Viewers.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Permission mock (mutated per test) ──
let mockPerms = {}
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => mockPerms,
}))

const ROWS = [
  { id: 1, key: 'TP-1', title: 'First issue', status: 'To Do', priority: 'Medium', issueType: 'Task', assignee: 'Alice', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Second issue', status: 'In Progress', priority: 'High', issueType: 'Bug', assignee: 'Bob', sprintId: null, projectId: 1 },
]

const handleMove = vi.fn(() => Promise.resolve())
const handleUpdate = vi.fn(() => Promise.resolve())
const handleDelete = vi.fn(() => Promise.resolve())
const handleCreate = vi.fn(() => Promise.resolve())

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: ROWS, handleCreate, handleMove, handleUpdate, handleDelete }),
}))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ authUser: { name: 'Alex Rivera', email: 'alex@test.com' } }) }))
vi.mock('../context/MemberContext', () => ({ useMembers: () => ({ profile: { full_name: 'Alex Rivera' } }) }))

import { WorkflowsPage } from '../pages/WorkflowsPage/WorkflowsPage'

const VIEWER_PERMS = {
  loaded: true,
  canCreateIssue: false,
  canEditIssue: false,
  canDeleteIssue: false,
}

const MEMBER_PERMS = {
  loaded: true,
  canCreateIssue: true,
  canEditIssue: true,
  canDeleteIssue: true,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkflowsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('JL-294 — List view (WorkflowsPage) RBAC gating', () => {
  describe('Viewer sees a read-only list', () => {
    beforeEach(() => { mockPerms = { ...VIEWER_PERMS } })

    it('still shows the list rows and supports read navigation', () => {
      renderPage()
      expect(screen.getByText('First issue')).toBeInTheDocument()
      expect(screen.getByText('TP-1')).toBeInTheDocument()
      expect(screen.getByText('Second issue')).toBeInTheDocument()
    })

    it('hides row checkboxes and the select-all checkbox', () => {
      renderPage()
      expect(screen.queryByLabelText('Select all issues on this page')).toBeNull()
      expect(screen.queryByLabelText('Select TP-1')).toBeNull()
      expect(screen.queryByLabelText('Select TP-2')).toBeNull()
    })

    it('never shows the bulk-action bar', () => {
      renderPage()
      expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull()
      expect(screen.queryByLabelText('Bulk action')).toBeNull()
    })

    it('hides the inline "+ Create" row', () => {
      renderPage()
      expect(document.querySelector('.jira-list-create')).toBeNull()
      expect(document.querySelector('.quick-create-row')).toBeNull()
      expect(screen.queryByPlaceholderText('What needs to be done?')).toBeNull()
    })
  })

  describe('Member sees full write controls', () => {
    beforeEach(() => { mockPerms = { ...MEMBER_PERMS } })

    it('shows the select-all checkbox and per-row checkboxes', () => {
      renderPage()
      expect(screen.getByLabelText('Select all issues on this page')).toBeInTheDocument()
      expect(screen.getByLabelText('Select TP-1')).toBeInTheDocument()
      expect(screen.getByLabelText('Select TP-2')).toBeInTheDocument()
    })

    it('shows the bulk-action bar with Status/Priority/Delete once a row is selected', () => {
      renderPage()
      fireEvent.click(screen.getByLabelText('Select TP-1'))
      expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeInTheDocument()
      const picker = screen.getByLabelText('Bulk action')
      const options = Array.from(picker.querySelectorAll('option')).map((o) => o.value)
      expect(options).toContain('status')
      expect(options).toContain('priority')
      expect(options).toContain('delete')
    })

    it('shows the inline "+ Create" row and opens the quick-create form', () => {
      renderPage()
      expect(document.querySelector('.jira-list-create')).toBeInTheDocument()
      fireEvent.click(document.querySelector('.jira-list-create'))
      expect(screen.getByPlaceholderText('What needs to be done?')).toBeInTheDocument()
    })
  })
})
