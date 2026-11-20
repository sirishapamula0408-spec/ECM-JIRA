// JL-484: each Backlog row has a Jira-style "…" → Move to menu. From a sprint
// it offers the Backlog and the project's other open sprints; from the backlog,
// the open sprints. Moving behaves exactly like dropping the row on that panel.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

let mockPerms
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => mockPerms }))
const handleMove = vi.fn()
vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({ sprints: SPRINTS, handleCreateSprint: vi.fn(), handleStartSprint: vi.fn(), handleUpdateSprint: vi.fn(), handleDeleteSprint: vi.fn() }),
}))
const ISSUES = [
  { id: 1, key: 'TP-1', title: 'Backlog story', status: 'Backlog', priority: 'Medium', issueType: 'Story', assignee: 'Alice', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Sprint task', status: 'In Progress', priority: 'High', issueType: 'Task', assignee: 'Bob', sprintId: 10, projectId: 1 },
]
const SPRINTS = [
  { id: 10, projectId: 1, name: 'TP Sprint 1', dateRange: '7 Dec - 21 Dec', isStarted: false },
  { id: 11, projectId: 1, name: 'TP Sprint 2', dateRange: '21 Dec - 4 Jan', isStarted: false },
  { id: 12, projectId: 1, name: 'TP Sprint 0', dateRange: 'done', isStarted: true, completedAt: '2026-11-01T00:00:00Z' },
]
vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: ISSUES, handleMove, handleCreate: vi.fn(), reloadIssues: vi.fn() }),
}))
vi.mock('../context/MemberContext', () => ({ useMembers: () => ({ profile: { full_name: 'Lee' }, members: [] }) }))
vi.mock('../api/issueConfigApi', () => ({ fetchProjectStatuses: vi.fn(async () => []), fetchProjectPriorities: vi.fn(async () => []) }))
vi.mock('../api/labelApi', () => ({ fetchProjectLabels: vi.fn(async () => []) }))
vi.mock('../api/dependencyApi', () => ({ fetchProjectDependencies: vi.fn(async () => ({ byId: {}, edges: [], cycles: [], blockedCount: 0 })) }))
vi.mock('../api/issueApi', () => ({ bulkChangeIssues: vi.fn() }))
vi.mock('../api/watcherApi', () => ({ watchIssue: vi.fn(), unwatchIssue: vi.fn() }))

import { BacklogPage } from '../pages/BacklogPage/BacklogPage'
import { BacklogIssueRow } from '../components/issues/BacklogIssueRow'

const EDITOR = { loaded: true, isAdmin: false, canCreateIssue: true, canEditIssue: true, canDeleteIssue: false, canManageSprints: false, canExportIssues: true }

function renderBacklog() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/backlog']}>
      <Routes><Route path="/projects/:projectId/backlog" element={<BacklogPage />} /></Routes>
    </MemoryRouter>,
  )
}

// Sprints start collapsed on the Backlog; open TP Sprint 1 to see its rows.
const expandSprint1 = () => fireEvent.click(screen.getByRole('button', { name: 'Expand TP Sprint 1' }))
const menuLabels = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  mockPerms = { ...EDITOR }
  handleMove.mockResolvedValue({})
})

describe('BacklogIssueRow "…" menu', () => {
  const issue = ISSUES[1]
  it('lists the targets under "Move to" and reports the chosen one', () => {
    const onMoveTo = vi.fn()
    render(<BacklogIssueRow issue={issue} onMove={vi.fn()} onOpen={vi.fn()} onToggleSelect={vi.fn()} onDragStart={vi.fn()} onDragEnd={vi.fn()}
      moveTargets={[{ id: 'backlog', label: 'Backlog' }, { id: 11, label: 'TP Sprint 2' }]} onMoveTo={onMoveTo} />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TP-2' }))
    expect(screen.getByText('Move to')).toBeInTheDocument()
    expect(menuLabels()).toEqual(['Backlog', 'TP Sprint 2'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Backlog' }))
    expect(onMoveTo).toHaveBeenCalledWith(issue, { id: 'backlog', label: 'Backlog' })
  })

  it('has no menu for someone who cannot edit, or with nowhere to move', () => {
    const props = { issue, onMove: vi.fn(), onOpen: vi.fn(), onToggleSelect: vi.fn(), onDragStart: vi.fn(), onDragEnd: vi.fn(), onMoveTo: vi.fn() }
    const { rerender } = render(<BacklogIssueRow {...props} canEdit={false} moveTargets={[{ id: 'backlog', label: 'Backlog' }]} />)
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull()
    rerender(<BacklogIssueRow {...props} canEdit moveTargets={[]} />)
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull()
  })
})

describe('on the Backlog page', () => {
  it('a sprint item offers Backlog and the other OPEN sprints (not its own, not completed)', () => {
    renderBacklog()
    expandSprint1()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TP-2' }))
    expect(menuLabels()).toEqual(['Backlog', 'TP Sprint 2'])
  })

  it('Move to → Backlog moves it out of the sprint, like dropping it on the Backlog', async () => {
    renderBacklog()
    expandSprint1()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TP-2' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Backlog' }))
    await waitFor(() => expect(handleMove).toHaveBeenCalledWith(2, 'Backlog', undefined))
    expect(await screen.findByText('TP-2 moved to the backlog.')).toBeInTheDocument()
  })

  it('Move to → another sprint keeps the status', async () => {
    renderBacklog()
    expandSprint1()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TP-2' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'TP Sprint 2' }))
    await waitFor(() => expect(handleMove).toHaveBeenCalledWith(2, 'In Progress', 11))
    expect(await screen.findByText('TP-2 moved to TP Sprint 2.')).toBeInTheDocument()
  })

  it('a backlog item offers the open sprints, and moving it in makes it To Do', async () => {
    renderBacklog()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TP-1' }))
    expect(menuLabels()).toEqual(['TP Sprint 1', 'TP Sprint 2'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'TP Sprint 1' }))
    await waitFor(() => expect(handleMove).toHaveBeenCalledWith(1, 'To Do', 10))
  })

  it('a Viewer gets no Move to menu', () => {
    mockPerms = { ...EDITOR, canEditIssue: false, canCreateIssue: false }
    renderBacklog()
    expect(screen.queryByRole('button', { name: /More actions for/ })).toBeNull()
  })
})
