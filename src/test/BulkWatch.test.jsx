import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

// Mock the watcher API (bulk Watch/Unwatch fans out to these)
vi.mock('../api/watcherApi', () => ({
  fetchWatchers: vi.fn().mockResolvedValue([]),
  watchIssue: vi.fn().mockResolvedValue({ watching: true }),
  unwatchIssue: vi.fn().mockResolvedValue({ watching: false }),
}))

// Mock contexts used by BacklogPage
const mockIssues = [
  { id: 1, key: 'TP-1', title: 'First backlog issue', status: 'Backlog', priority: 'Medium', issueType: 'Task', assignee: 'Alice', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Second backlog issue', status: 'Backlog', priority: 'High', issueType: 'Bug', assignee: 'Bob', sprintId: null, projectId: 1 },
  { id: 3, key: 'TP-3', title: 'Third backlog issue', status: 'Backlog', priority: 'Low', issueType: 'Story', assignee: 'Cara', sprintId: null, projectId: 1 },
]

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: mockIssues,
    handleMove: vi.fn(),
    handleUpdate: vi.fn(),
    handleDelete: vi.fn(),
    handleCreate: vi.fn(),
    reloadIssues: vi.fn(),
  }),
  IssueProvider: ({ children }) => children,
}))

vi.mock('../context/SprintContext', () => {
  // Stable reference — BacklogPage's useEffect(..., [sprints]) would loop on a fresh array each render.
  const sprints = []
  return {
    useSprints: () => ({
      sprints,
      handleCreateSprint: vi.fn(),
      handleStartSprint: vi.fn(),
      handleUpdateSprint: vi.fn(),
      handleDeleteSprint: vi.fn(),
    }),
    SprintProvider: ({ children }) => children,
  }
})

vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    members: [{ id: 1, name: 'Alice', email: 'alice@test.com' }],
    profile: { full_name: 'Alice' },
    currentMember: { workspaceRole: 'Admin', isOwner: false, projectRoles: [] },
  }),
  MemberProvider: ({ children }) => children,
}))

import { BacklogPage } from '../pages/BacklogPage/BacklogPage'
import { watchIssue, unwatchIssue } from '../api/watcherApi'

function renderBacklog() {
  return render(
    <BrowserRouter>
      <BacklogPage />
    </BrowserRouter>,
  )
}

function selectIssuesAndApply(action) {
  // Select two of the three backlog issues
  fireEvent.click(screen.getByLabelText('Select TP-1'))
  fireEvent.click(screen.getByLabelText('Select TP-2'))
  // Choose the bulk action and apply
  fireEvent.change(screen.getByLabelText('Bulk action'), { target: { value: action } })
  fireEvent.click(screen.getByText('Apply'))
}

describe('Backlog bulk watch / unwatch (JL-165)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers Watch and Unwatch options in the bulk action picker', () => {
    renderBacklog()
    const picker = screen.getByLabelText('Bulk action')
    const values = Array.from(picker.querySelectorAll('option')).map((o) => o.value)
    expect(values).toContain('watch')
    expect(values).toContain('unwatch')
  })

  it('calls watchIssue once per selected issue on bulk Watch', async () => {
    renderBacklog()
    selectIssuesAndApply('watch')
    await waitFor(() => {
      expect(watchIssue).toHaveBeenCalledTimes(2)
    })
    expect(watchIssue).toHaveBeenCalledWith(1)
    expect(watchIssue).toHaveBeenCalledWith(2)
    expect(watchIssue).not.toHaveBeenCalledWith(3)
    expect(unwatchIssue).not.toHaveBeenCalled()
    expect(await screen.findByText('Now watching 2 issue(s).')).toBeInTheDocument()
  })

  it('calls unwatchIssue once per selected issue on bulk Unwatch', async () => {
    renderBacklog()
    selectIssuesAndApply('unwatch')
    await waitFor(() => {
      expect(unwatchIssue).toHaveBeenCalledTimes(2)
    })
    expect(unwatchIssue).toHaveBeenCalledWith(1)
    expect(unwatchIssue).toHaveBeenCalledWith(2)
    expect(unwatchIssue).not.toHaveBeenCalledWith(3)
    expect(watchIssue).not.toHaveBeenCalled()
    expect(await screen.findByText('Stopped watching 2 issue(s).')).toBeInTheDocument()
  })

  it('clears the selection after a bulk watch', async () => {
    renderBacklog()
    selectIssuesAndApply('watch')
    await waitFor(() => {
      expect(screen.getByText('0 selected')).toBeInTheDocument()
    })
  })

  it('does not call the watcher API when nothing is selected', () => {
    renderBacklog()
    fireEvent.click(screen.getByText('Apply'))
    expect(watchIssue).not.toHaveBeenCalled()
    expect(unwatchIssue).not.toHaveBeenCalled()
  })
})
