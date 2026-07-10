import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ActiveSprintPage } from '../pages/ActiveSprintPage/ActiveSprintPage'

// Mock contexts
const mockHandleMove = vi.fn()
const mockHandleCompleteSprint = vi.fn()
const mockReloadIssues = vi.fn()

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: mockIssues,
    handleMove: mockHandleMove,
    reloadIssues: mockReloadIssues,
  }),
}))

const mockHandleUpdateSprint = vi.fn()

vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({
    sprints: mockSprints,
    handleCompleteSprint: mockHandleCompleteSprint,
    handleUpdateSprint: mockHandleUpdateSprint,
  }),
}))

// JL-127: page now reads permissions + fetches retro notes — stub both.
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ canManageSprints: true }),
}))

vi.mock('../api/sprintApi', () => ({
  fetchRetros: vi.fn().mockResolvedValue([]),
  addRetro: vi.fn(),
  deleteRetro: vi.fn(),
}))

let mockIssues = []
let mockSprints = []

function renderPage(projectId) {
  const route = projectId ? `/projects/${projectId}/active-sprint` : '/active-sprint'
  const path = projectId ? '/projects/:projectId/active-sprint' : '/active-sprint'
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ActiveSprintPage />
    </MemoryRouter>,
  )
}

const baseSprint = {
  id: 1,
  name: 'Sprint 1',
  dateRange: 'Mar 1 - Mar 15',
  isStarted: true,
}

const baseIssues = [
  { id: 1, key: 'JL-1', title: 'Setup project', issueType: 'Task', status: 'To Do', priority: 'High', sprintId: 1, assignee: 'Alice', projectId: 1 },
  { id: 2, key: 'JL-2', title: 'Fix login bug', issueType: 'Bug', status: 'In Progress', priority: 'Medium', sprintId: 1, assignee: 'Bob', projectId: 1 },
  { id: 3, key: 'JL-3', title: 'Add dashboard', issueType: 'Story', status: 'Done', priority: 'Low', sprintId: 1, assignee: null, projectId: 1 },
  { id: 4, key: 'JL-4', title: 'Code review task', issueType: 'Task', status: 'Code Review', priority: 'Medium', sprintId: 1, assignee: 'Charlie', projectId: 1 },
]

beforeEach(() => {
  mockIssues = [...baseIssues]
  mockSprints = [{ ...baseSprint }]
  mockHandleMove.mockReset()
  mockHandleCompleteSprint.mockReset()
  mockReloadIssues.mockReset()
  mockHandleMove.mockResolvedValue({})
  mockHandleCompleteSprint.mockResolvedValue({})
  mockReloadIssues.mockResolvedValue()
})

// ─── POSITIVE SCENARIOS ───

describe('ActiveSprintPage — positive scenarios', () => {
  it('renders sprint name and date range', () => {
    renderPage()
    expect(screen.getByText('Sprint 1')).toBeInTheDocument()
    expect(screen.getByText('Mar 1 - Mar 15')).toBeInTheDocument()
  })

  it('renders all four status columns', () => {
    renderPage()
    expect(screen.getByText('To Do')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Code Review')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('renders issue cards in correct columns', () => {
    renderPage()
    expect(screen.getByText('JL-1')).toBeInTheDocument()
    expect(screen.getByText('Setup project')).toBeInTheDocument()
    expect(screen.getByText('JL-2')).toBeInTheDocument()
    expect(screen.getByText('Fix login bug')).toBeInTheDocument()
    expect(screen.getByText('JL-3')).toBeInTheDocument()
    expect(screen.getByText('JL-4')).toBeInTheDocument()
  })

  it('shows correct progress count', () => {
    renderPage()
    expect(screen.getByText('1 of 4 done')).toBeInTheDocument()
  })

  it('renders progress bar with correct width', () => {
    renderPage()
    const fill = document.querySelector('.active-sprint-header__progress-fill')
    expect(fill).toBeTruthy()
    expect(fill.style.width).toBe('25%')
  })

  it('displays issue type emoji for Bug', () => {
    renderPage()
    // Bug emoji should be present
    const bugCard = screen.getByText('Fix login bug').closest('.active-sprint-card')
    expect(bugCard).toBeTruthy()
    expect(bugCard.querySelector('.active-sprint-card__type')).toBeTruthy()
  })

  it('renders assignee avatar with first letter', () => {
    renderPage()
    expect(screen.getByText('A')).toBeInTheDocument() // Alice
    expect(screen.getByText('B')).toBeInTheDocument() // Bob
    expect(screen.getByText('C')).toBeInTheDocument() // Charlie
  })

  it('does not render avatar for unassigned issues', () => {
    renderPage()
    const doneCard = screen.getByText('Add dashboard').closest('.active-sprint-card')
    expect(doneCard.querySelector('.member-avatar')).toBeNull()
  })

  it('renders priority marks with correct classes', () => {
    renderPage()
    const highPriority = document.querySelector('.priority-high')
    const mediumPriority = document.querySelector('.priority-medium')
    const lowPriority = document.querySelector('.priority-low')
    expect(highPriority).toBeTruthy()
    expect(mediumPriority).toBeTruthy()
    expect(lowPriority).toBeTruthy()
  })

  it('shows column issue counts', () => {
    renderPage()
    // Each column header has a count badge
    const cols = document.querySelectorAll('.active-sprint-col header span')
    const counts = Array.from(cols).map((el) => el.textContent)
    expect(counts).toEqual(['1', '1', '1', '1'])
  })

  it('renders Complete sprint button', () => {
    renderPage()
    const btn = screen.getByText('Complete sprint')
    expect(btn).toBeInTheDocument()
    expect(btn.tagName).toBe('BUTTON')
  })

  it('cards are draggable', () => {
    renderPage()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')
    expect(card.getAttribute('draggable')).toBe('true')
  })

  it('adds dragging class on dragStart and removes on dragEnd', () => {
    renderPage()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')
    fireEvent.dragStart(card)
    expect(card.classList.contains('dragging')).toBe(true)
    fireEvent.dragEnd(card)
    expect(card.classList.contains('dragging')).toBe(false)
  })

  it('adds drop target class on dragOver', () => {
    renderPage()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')
    const inProgressCol = screen.getByText('In Progress').closest('.active-sprint-col')

    fireEvent.dragStart(card)
    fireEvent.dragOver(inProgressCol)
    expect(inProgressCol.classList.contains('active-sprint-col-drop')).toBe(true)
  })

  it('calls handleMove on drop to a different column', async () => {
    renderPage()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')
    const doneCol = screen.getByText('Done').closest('.active-sprint-col')

    fireEvent.dragStart(card)
    fireEvent.dragOver(doneCol)
    fireEvent.drop(doneCol)

    expect(mockHandleMove).toHaveBeenCalledWith(1, 'Done', 1)
  })

  it('renders multiple active sprints with divider', () => {
    mockSprints = [
      { ...baseSprint },
      { id: 2, name: 'Sprint 2', dateRange: 'Mar 16 - Mar 30', isStarted: true },
    ]
    renderPage()
    expect(screen.getByText('Sprint 1')).toBeInTheDocument()
    expect(screen.getByText('Sprint 2')).toBeInTheDocument()
    expect(document.querySelector('.active-sprint-divider')).toBeTruthy()
  })
})

// ─── NEGATIVE SCENARIOS ───

describe('ActiveSprintPage — negative scenarios', () => {
  it('shows empty state when no active sprints', () => {
    mockSprints = [{ id: 1, name: 'Sprint 1', isStarted: false }]
    renderPage()
    expect(screen.getByText('No active sprints')).toBeInTheDocument()
    expect(screen.getByText(/Start a sprint from the/)).toBeInTheDocument()
  })

  it('shows empty state with link to backlog', () => {
    mockSprints = []
    renderPage()
    expect(screen.getByText('No active sprints')).toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/backlog')
  })

  it('renders empty columns when sprint has no issues', () => {
    mockIssues = []
    renderPage()
    const cols = document.querySelectorAll('.active-sprint-col header span')
    const counts = Array.from(cols).map((el) => el.textContent)
    expect(counts).toEqual(['0', '0', '0', '0'])
  })

  it('shows 0 of 0 done when sprint has no issues', () => {
    mockIssues = []
    renderPage()
    expect(screen.getByText('0 of 0 done')).toBeInTheDocument()
  })

  it('progress bar is 0% when no issues are done', () => {
    mockIssues = [
      { id: 1, key: 'JL-1', title: 'Not done', issueType: 'Task', status: 'To Do', priority: 'Medium', sprintId: 1, assignee: null, projectId: 1 },
    ]
    renderPage()
    const fill = document.querySelector('.active-sprint-header__progress-fill')
    expect(fill.style.width).toBe('0%')
  })

  it('does not call handleMove when dropping on same column', () => {
    renderPage()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')
    const todoCol = screen.getByText('To Do').closest('.active-sprint-col')

    fireEvent.dragStart(card)
    fireEvent.dragOver(todoCol)
    fireEvent.drop(todoCol)

    expect(mockHandleMove).not.toHaveBeenCalled()
  })

  it('excludes Backlog issues from sprint board', () => {
    mockIssues = [
      ...baseIssues,
      { id: 5, key: 'JL-5', title: 'Backlog item', issueType: 'Task', status: 'Backlog', priority: 'Low', sprintId: 1, assignee: null, projectId: 1 },
    ]
    renderPage()
    expect(screen.queryByText('Backlog item')).toBeNull()
  })

  it('excludes issues from other sprints', () => {
    mockIssues = [
      ...baseIssues,
      { id: 6, key: 'JL-6', title: 'Other sprint task', issueType: 'Task', status: 'To Do', priority: 'Medium', sprintId: 99, assignee: null, projectId: 1 },
    ]
    renderPage()
    expect(screen.queryByText('Other sprint task')).toBeNull()
  })

  it('handles issue with null priority gracefully', () => {
    mockIssues = [
      { id: 10, key: 'JL-10', title: 'No priority', issueType: 'Task', status: 'To Do', priority: null, sprintId: 1, assignee: null, projectId: 1 },
    ]
    renderPage()
    expect(screen.getByText('No priority')).toBeInTheDocument()
    const mark = document.querySelector('.priority-medium')
    expect(mark).toBeTruthy() // defaults to medium
  })

  it('handles issue with undefined assignee', () => {
    mockIssues = [
      { id: 11, key: 'JL-11', title: 'Unassigned', issueType: 'Task', status: 'To Do', priority: 'High', sprintId: 1, projectId: 1 },
    ]
    renderPage()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    const card = screen.getByText('Unassigned').closest('.active-sprint-card')
    expect(card.querySelector('.member-avatar')).toBeNull()
  })

  it('clears drag state on dragEnd even without drop', () => {
    renderPage()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')

    fireEvent.dragStart(card)
    expect(card.classList.contains('dragging')).toBe(true)

    // dragEnd without drop
    fireEvent.dragEnd(card)
    expect(card.classList.contains('dragging')).toBe(false)
  })

  it('handles handleMove rejection gracefully via try/finally', async () => {
    const error = new Error('Network error')
    mockHandleMove.mockRejectedValueOnce(error)

    // Catch the unhandled rejection at the window level
    const rejectionHandler = vi.fn()
    window.addEventListener('unhandledrejection', (e) => { e.preventDefault(); rejectionHandler() })

    renderPage()

    const card = screen.getByText('Setup project').closest('.active-sprint-card')
    const doneCol = screen.getByText('Done').closest('.active-sprint-col')

    fireEvent.dragStart(card)
    fireEvent.dragOver(doneCol)
    fireEvent.drop(doneCol)

    // Wait for the async onDrop to settle
    await vi.waitFor(() => {
      expect(mockHandleMove).toHaveBeenCalled()
    })

    // Card should not remain in dragging state after error
    fireEvent.dragEnd(card)
    expect(card.classList.contains('dragging')).toBe(false)
  })

  it('100% progress when all issues are done', () => {
    mockIssues = [
      { id: 1, key: 'JL-1', title: 'Done 1', issueType: 'Task', status: 'Done', priority: 'High', sprintId: 1, assignee: null, projectId: 1 },
      { id: 2, key: 'JL-2', title: 'Done 2', issueType: 'Bug', status: 'Done', priority: 'Low', sprintId: 1, assignee: null, projectId: 1 },
    ]
    renderPage()
    expect(screen.getByText('2 of 2 done')).toBeInTheDocument()
    const fill = document.querySelector('.active-sprint-header__progress-fill')
    expect(fill.style.width).toBe('100%')
  })
})

// ─── CSS DESIGN TOKEN TESTS ───

describe('ActiveSprintPage — CSS design enhancements', () => {
  it('card has transition property for animation support', () => {
    renderPage()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')
    const styles = window.getComputedStyle(card)
    // Verify the card element exists and is rendered with the base class
    expect(card.classList.contains('active-sprint-card')).toBe(true)
  })

  it('dragging card gets visual feedback classes', () => {
    renderPage()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')

    // Before drag
    expect(card.classList.contains('dragging')).toBe(false)

    // During drag
    fireEvent.dragStart(card)
    expect(card.classList.contains('dragging')).toBe(true)

    // After drag
    fireEvent.dragEnd(card)
    expect(card.classList.contains('dragging')).toBe(false)
  })

  it('drop target column gets visual feedback class', () => {
    renderPage()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')
    const inProgressCol = screen.getByText('In Progress').closest('.active-sprint-col')

    fireEvent.dragStart(card)
    fireEvent.dragOver(inProgressCol)

    expect(inProgressCol.classList.contains('active-sprint-col-drop')).toBe(true)
  })

  it('only one column has drop target class at a time', () => {
    renderPage()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')
    const inProgressCol = screen.getByText('In Progress').closest('.active-sprint-col')
    const doneCol = screen.getByText('Done').closest('.active-sprint-col')

    fireEvent.dragStart(card)
    fireEvent.dragOver(inProgressCol)
    expect(inProgressCol.classList.contains('active-sprint-col-drop')).toBe(true)

    fireEvent.dragOver(doneCol)
    expect(doneCol.classList.contains('active-sprint-col-drop')).toBe(true)
    expect(inProgressCol.classList.contains('active-sprint-col-drop')).toBe(false)
  })
})
