import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BacklogPage } from '../pages/BacklogPage/BacklogPage'

// The current user is "Alex Rivera" (from the member profile).
// Issues cover: mine + open (kept), someone else's + open (hidden),
// and mine + Done (hidden) when the chip is active.
const ISSUES = [
  { id: 1, key: 'JL-1', title: 'Mine backlog task', assignee: 'Alex Rivera', status: 'Backlog', priority: 'Medium', issueType: 'Task', sprintId: null, projectId: 1 },
  { id: 2, key: 'JL-2', title: 'Other backlog task', assignee: 'Sam Chen', status: 'Backlog', priority: 'Medium', issueType: 'Task', sprintId: null, projectId: 1 },
  { id: 3, key: 'JL-3', title: 'Mine in progress task', assignee: 'Alex Rivera', status: 'In Progress', priority: 'High', issueType: 'Story', sprintId: 10, projectId: 1 },
  { id: 4, key: 'JL-4', title: 'Mine done task', assignee: 'Alex Rivera', status: 'Done', priority: 'Low', issueType: 'Bug', sprintId: 10, projectId: 1 },
  { id: 5, key: 'JL-5', title: 'Other in progress task', assignee: 'Sam Chen', status: 'In Progress', priority: 'Medium', issueType: 'Task', sprintId: 10, projectId: 1 },
]

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: ISSUES,
    handleMove: vi.fn(),
    handleUpdate: vi.fn(),
    handleDelete: vi.fn(),
    handleCreate: vi.fn(),
    reloadIssues: vi.fn(),
  }),
}))

vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({
    sprints: [{ id: 10, name: 'Sprint 1', dateRange: 'Jul 1 - Jul 14', isStarted: false }],
    handleCreateSprint: vi.fn(),
    handleStartSprint: vi.fn(),
    handleUpdateSprint: vi.fn(),
    handleDeleteSprint: vi.fn(),
  }),
}))

vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    profile: { full_name: 'Alex Rivera' },
    members: [
      { id: 1, name: 'Alex Rivera' },
      { id: 2, name: 'Sam Chen' },
    ],
  }),
}))

function renderBacklog() {
  return render(
    <MemoryRouter>
      <BacklogPage />
    </MemoryRouter>,
  )
}

describe('BacklogPage — "My open issues" quick chip', () => {
  it('renders the chip inactive by default with all issues visible', () => {
    renderBacklog()

    // Expand the sprint panel so sprint-scoped issues are visible too.
    fireEvent.click(screen.getByRole('button', { name: 'Expand Sprint 1' }))

    const chip = screen.getByText('My open issues')
    expect(chip).toBeInTheDocument()

    for (const issue of ISSUES) {
      expect(screen.getByText(issue.title)).toBeInTheDocument()
    }
  })

  it('toggling the chip on shows only the current user\'s non-Done issues', () => {
    renderBacklog()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Sprint 1' }))

    fireEvent.click(screen.getByText('My open issues'))

    // Kept: assigned to Alex Rivera and not Done.
    expect(screen.getByText('Mine backlog task')).toBeInTheDocument()
    expect(screen.getByText('Mine in progress task')).toBeInTheDocument()

    // Hidden: other assignees and Done issues (even the current user's).
    expect(screen.queryByText('Other backlog task')).not.toBeInTheDocument()
    expect(screen.queryByText('Other in progress task')).not.toBeInTheDocument()
    expect(screen.queryByText('Mine done task')).not.toBeInTheDocument()
  })

  it('toggling the chip off restores the full issue list', () => {
    renderBacklog()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Sprint 1' }))

    const chip = screen.getByText('My open issues')
    fireEvent.click(chip)
    expect(screen.queryByText('Other backlog task')).not.toBeInTheDocument()

    fireEvent.click(chip)
    for (const issue of ISSUES) {
      expect(screen.getByText(issue.title)).toBeInTheDocument()
    }
  })
})
