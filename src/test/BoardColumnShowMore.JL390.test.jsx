import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { BoardPage } from '../pages/BoardPage/BoardPage'

// ── JL-390: board columns cap at five cards with a "Show N more" expander ──
// `.kanban-col` is overflow-y: visible, so an unbounded column pushed the whole
// page down instead of scrolling inside itself — an eight-card In Progress
// column ran off the viewport while its neighbours sat short.
//
// The board renders SWIMLANES × COLUMNS, so the expanded state belongs to a
// (lane, column) PAIR, and the header count / JL-355 WIP check must keep
// reading the FULL issue list while the rendered list is truncated. Both are
// pinned below.

const mockHandleMove = vi.fn()

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: mockIssues, handleMove: mockHandleMove }),
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ canManageProjectSettings: true, canEditIssue: true }),
}))

const mockFetchBoardConfig = vi.fn()
const mockSaveBoardConfig = vi.fn()
vi.mock('../api/boardConfigApi', () => ({
  fetchBoardConfig: (...args) => mockFetchBoardConfig(...args),
  saveBoardConfig: (...args) => mockSaveBoardConfig(...args),
  ESTIMATION_STATISTIC_OPTIONS: [
    { value: 'story_points', label: 'Story Points' },
    { value: 'time_estimate', label: 'Original Time Estimate' },
    { value: 'issue_count', label: 'Issue Count' },
  ],
}))

let mockIssues = []

function issue(id, status, assignee = 'Alice') {
  return {
    id,
    key: `JL-${id}`,
    title: `Issue ${id}`,
    issueType: 'Task',
    status,
    priority: 'Medium',
    assignee,
    projectId: 1,
  }
}

// Build `count` issues in `status`, ids offset so keys stay unique across columns.
function issuesIn(status, count, { from = 1, assignee = 'Alice' } = {}) {
  return Array.from({ length: count }, (_, i) => issue(from + i, status, assignee))
}

const emptyConfig = {
  projectId: 1,
  swimlaneBy: 'none',
  wipLimits: {},
  quickFilters: [],
  estimationStatistic: 'story_points',
  columns: [],
}

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/board']}>
      <Routes>
        <Route path="/projects/:projectId/board" element={<BoardPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function getColumn(name, root = document) {
  return root.querySelector(`.kanban-col[data-column="${name}"]`)
}

function cardsIn(col) {
  return col.querySelectorAll('.card.kanban-card-draggable')
}

function getLane(key) {
  return document.querySelector(`.board-swimlane[data-swimlane="${key}"]`)
}

beforeEach(() => {
  window.localStorage.clear()
  mockIssues = []
  mockHandleMove.mockReset().mockResolvedValue({})
  mockFetchBoardConfig.mockReset().mockResolvedValue(emptyConfig)
  mockSaveBoardConfig.mockReset().mockResolvedValue({})
})

describe('JL-390 — five-card cap and the expander', () => {
  it('renders every card and NO expander when a column holds five or fewer', async () => {
    mockIssues = issuesIn('To Do', 5)
    renderBoard()
    await waitFor(() => expect(getColumn('To Do')).toBeTruthy())

    const col = getColumn('To Do')
    await waitFor(() => expect(cardsIn(col)).toHaveLength(5))
    expect(within(col).getByText('Issue 5')).toBeInTheDocument()
    expect(col.querySelector('.kanban-col-show-more')).toBeNull()
  })

  it('renders exactly five cards plus an expander carrying the correct remainder', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(getColumn('In Progress')).toBeTruthy())

    const col = getColumn('In Progress')
    await waitFor(() => expect(cardsIn(col)).toHaveLength(5))
    // The first five render; the sixth onwards are withheld.
    expect(within(col).getByText('Issue 5')).toBeInTheDocument()
    expect(within(col).queryByText('Issue 6')).toBeNull()

    const expander = col.querySelector('.kanban-col-show-more')
    expect(expander).toBeTruthy()
    expect(expander.textContent).toBe('Show 3 more')
    expect(expander.getAttribute('aria-expanded')).toBe('false')
  })

  it('singularises the remainder when exactly one card is hidden', async () => {
    mockIssues = issuesIn('To Do', 6)
    renderBoard()
    await waitFor(() => expect(getColumn('To Do')).toBeTruthy())

    const col = getColumn('To Do')
    await waitFor(() => expect(col.querySelector('.kanban-col-show-more')).toBeTruthy())
    const expander = col.querySelector('.kanban-col-show-more')
    expect(expander.textContent).toBe('Show 1 more')
    expect(expander.getAttribute('aria-label')).toBe('Show 1 more card in To Do')
  })

  it('reveals all cards when activated and collapses back to five', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(getColumn('In Progress')).toBeTruthy())

    const col = getColumn('In Progress')
    await waitFor(() => expect(cardsIn(col)).toHaveLength(5))

    fireEvent.click(col.querySelector('.kanban-col-show-more'))
    expect(cardsIn(getColumn('In Progress'))).toHaveLength(8)
    expect(within(getColumn('In Progress')).getByText('Issue 8')).toBeInTheDocument()

    const collapse = getColumn('In Progress').querySelector('.kanban-col-show-more')
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    expect(collapse.textContent).toBe('Show less')

    fireEvent.click(collapse)
    expect(cardsIn(getColumn('In Progress'))).toHaveLength(5)
    expect(within(getColumn('In Progress')).queryByText('Issue 8')).toBeNull()
    expect(getColumn('In Progress').querySelector('.kanban-col-show-more').textContent).toBe('Show 3 more')
  })
})

describe('JL-390 — expanded state is per (lane, column) pair', () => {
  it('expanding a column in one swimlane leaves the same column collapsed in another', async () => {
    // Alice and Bob each hold 8 In Progress issues.
    mockIssues = [
      ...issuesIn('In Progress', 8, { from: 1, assignee: 'Alice' }),
      ...issuesIn('In Progress', 8, { from: 101, assignee: 'Bob' }),
    ]
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Swimlanes'), { target: { value: 'assignee' } })
    await waitFor(() => expect(getLane('Alice')).toBeTruthy())
    expect(getLane('Bob')).toBeTruthy()

    // Both lanes start collapsed at five.
    expect(cardsIn(getColumn('In Progress', getLane('Alice')))).toHaveLength(5)
    expect(cardsIn(getColumn('In Progress', getLane('Bob')))).toHaveLength(5)

    // Expand only Alice's In Progress.
    fireEvent.click(getColumn('In Progress', getLane('Alice')).querySelector('.kanban-col-show-more'))

    expect(cardsIn(getColumn('In Progress', getLane('Alice')))).toHaveLength(8)
    // Bob's copy of the SAME column must be untouched.
    expect(cardsIn(getColumn('In Progress', getLane('Bob')))).toHaveLength(5)
    expect(getColumn('In Progress', getLane('Bob'))
      .querySelector('.kanban-col-show-more')
      .getAttribute('aria-expanded')).toBe('false')
  })

  it('expanding one column leaves the other columns in the same lane collapsed', async () => {
    mockIssues = [
      ...issuesIn('To Do', 7, { from: 1 }),
      ...issuesIn('In Progress', 8, { from: 101 }),
    ]
    renderBoard()
    await waitFor(() => expect(getColumn('To Do')).toBeTruthy())
    await waitFor(() => expect(cardsIn(getColumn('To Do'))).toHaveLength(5))

    fireEvent.click(getColumn('In Progress').querySelector('.kanban-col-show-more'))

    expect(cardsIn(getColumn('In Progress'))).toHaveLength(8)
    expect(cardsIn(getColumn('To Do'))).toHaveLength(5)
  })
})

describe('JL-390 — the header count and WIP check keep reading the TOTAL', () => {
  it('shows the full count in the header while the column is truncated', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(getColumn('In Progress')).toBeTruthy())

    const col = getColumn('In Progress')
    await waitFor(() => expect(cardsIn(col)).toHaveLength(5))
    // Five cards rendered, but the header must still say 8 — not 5.
    expect(col.querySelector('.kanban-count').textContent).toBe('8')
  })

  it('still fires the over-WIP indicator for a limit above five while collapsed', async () => {
    // Regression guard: if the WIP check read the truncated list (5), a limit of
    // 6 could never be exceeded and the indicator would silently stop working.
    mockFetchBoardConfig.mockResolvedValue({ ...emptyConfig, wipLimits: { 'In Progress': 6 } })
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(getColumn('In Progress')).toBeTruthy())

    const col = getColumn('In Progress')
    await waitFor(() => expect(col.classList.contains('kanban-col-over-wip')).toBe(true))
    expect(cardsIn(col)).toHaveLength(5)
    const count = col.querySelector('.kanban-count')
    expect(count.textContent).toBe('8 / 6')
    expect(count.classList.contains('kanban-count-over')).toBe(true)
  })

  it('keeps the count and over-WIP state identical after expanding', async () => {
    mockFetchBoardConfig.mockResolvedValue({ ...emptyConfig, wipLimits: { 'In Progress': 6 } })
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(getColumn('In Progress')).toBeTruthy())
    await waitFor(() => expect(getColumn('In Progress').querySelector('.kanban-col-show-more')).toBeTruthy())

    fireEvent.click(getColumn('In Progress').querySelector('.kanban-col-show-more'))

    const col = getColumn('In Progress')
    expect(cardsIn(col)).toHaveLength(8)
    expect(col.querySelector('.kanban-count').textContent).toBe('8 / 6')
    expect(col.classList.contains('kanban-col-over-wip')).toBe(true)
  })
})

describe('JL-390 — accessibility and drag-and-drop', () => {
  it('gives the expander an accessible name that identifies its column', async () => {
    mockIssues = [
      ...issuesIn('To Do', 7, { from: 1 }),
      ...issuesIn('In Progress', 8, { from: 101 }),
    ]
    renderBoard()
    await waitFor(() => expect(getColumn('To Do')).toBeTruthy())

    // Two expanders on one page — each names its own column, so neither is
    // an ambiguous bare "Show N more" to a screen-reader user.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show 2 more cards in To Do' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Show 3 more cards in In Progress' })).toBeInTheDocument()
  })

  it('names the swimlane too when lanes are labelled', async () => {
    mockIssues = [
      ...issuesIn('In Progress', 8, { from: 1, assignee: 'Alice' }),
      ...issuesIn('In Progress', 7, { from: 101, assignee: 'Bob' }),
    ]
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Swimlanes'), { target: { value: 'assignee' } })

    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Show 3 more cards in In Progress in swimlane Alice' }),
    ).toBeInTheDocument())
    expect(
      screen.getByRole('button', { name: 'Show 2 more cards in In Progress in swimlane Bob' }),
    ).toBeInTheDocument()
  })

  it('is a real button: focusable and operable from the keyboard', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(getColumn('In Progress')).toBeTruthy())
    await waitFor(() => expect(getColumn('In Progress').querySelector('.kanban-col-show-more')).toBeTruthy())

    const expander = screen.getByRole('button', { name: 'Show 3 more cards in In Progress' })
    expect(expander.tagName).toBe('BUTTON')
    expect(expander.getAttribute('type')).toBe('button')

    expander.focus()
    expect(document.activeElement).toBe(expander)

    // Native buttons fire click on Enter/Space; assert the keyboard path lands
    // on the same handler by driving the click the browser would synthesise.
    fireEvent.keyDown(expander, { key: 'Enter', code: 'Enter' })
    fireEvent.click(expander)
    expect(cardsIn(getColumn('In Progress'))).toHaveLength(8)
  })

  it('keeps every card draggable collapsed and after expanding', async () => {
    mockIssues = issuesIn('In Progress', 8)
    renderBoard()
    await waitFor(() => expect(getColumn('In Progress')).toBeTruthy())
    await waitFor(() => expect(cardsIn(getColumn('In Progress'))).toHaveLength(5))

    // Collapsed: the visible five are draggable.
    for (const card of cardsIn(getColumn('In Progress'))) {
      expect(card.getAttribute('draggable')).toBe('true')
    }

    fireEvent.click(getColumn('In Progress').querySelector('.kanban-col-show-more'))

    const expandedCards = cardsIn(getColumn('In Progress'))
    expect(expandedCards).toHaveLength(8)
    for (const card of expandedCards) {
      expect(card.getAttribute('draggable')).toBe('true')
    }

    // A revealed card (the 8th, hidden while collapsed) still drops onto
    // another column through the untouched dragStart/drop wiring.
    fireEvent.dragStart(expandedCards[7])
    const target = getColumn('Done')
    fireEvent.dragOver(target)
    fireEvent.drop(target)

    await waitFor(() => expect(mockHandleMove).toHaveBeenCalledWith(8, 'Done', null))
  })
})
