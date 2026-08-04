import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { BoardPage } from '../pages/BoardPage/BoardPage'

// ── JL-355: WIP limits must resolve through a column's mapped statuses ──
// The board-config server contract persists wipLimits keyed by STATUS
// (server/routes/boardConfig.js). JL-308 custom columns can be renamed or map
// several statuses, so a lookup keyed by column NAME silently missed: the
// over-WIP highlight and the "n / limit" counter never fired for any column
// whose name differed from its status. These tests pin the fix: limits resolve
// via col.statuses, and a merged column's limit is the SUM of its mapped
// statuses' limits.

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

function issue(id, status) {
  return {
    id,
    key: `JL-${id}`,
    title: `Issue ${id}`,
    issueType: 'Task',
    status,
    priority: 'Medium',
    assignee: 'Alice',
    projectId: 1,
  }
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

function getColumn(name) {
  return document.querySelector(`.kanban-col[data-column="${name}"]`)
}

beforeEach(() => {
  mockIssues = []
  mockHandleMove.mockReset().mockResolvedValue({})
  mockFetchBoardConfig.mockReset().mockResolvedValue(emptyConfig)
  mockSaveBoardConfig.mockReset().mockResolvedValue({})
  window.localStorage.clear()
})

describe('JL-355 — WIP limit on a renamed custom column', () => {
  it('shows the over-WIP highlight and n / limit counter when the column name differs from its status', async () => {
    // Column "In Review" maps status "Code Review"; the saved limit is keyed
    // by the STATUS per the server contract.
    mockFetchBoardConfig.mockResolvedValue({
      ...emptyConfig,
      wipLimits: { 'Code Review': 1 },
      columns: [
        { id: 'c1', name: 'Ready', statuses: ['To Do'] },
        { id: 'c2', name: 'In Review', statuses: ['Code Review'] },
        { id: 'c3', name: 'Complete', statuses: ['Done'] },
      ],
    })
    mockIssues = [issue(1, 'Code Review'), issue(2, 'Code Review'), issue(3, 'To Do')]

    renderBoard()
    await waitFor(() => expect(getColumn('In Review')).toBeTruthy())

    const col = getColumn('In Review')
    // 2 issues over a limit of 1 → highlighted, counter shows "2 / 1".
    await waitFor(() => expect(col.classList.contains('kanban-col-over-wip')).toBe(true))
    const count = col.querySelector('.kanban-count')
    expect(count.textContent).toBe('2 / 1')
    expect(count.classList.contains('kanban-count-over')).toBe(true)
  })

  it('shows the counter without the highlight while within the limit', async () => {
    mockFetchBoardConfig.mockResolvedValue({
      ...emptyConfig,
      wipLimits: { 'Code Review': 3 },
      columns: [{ id: 'c1', name: 'In Review', statuses: ['Code Review'] }],
    })
    mockIssues = [issue(1, 'Code Review'), issue(2, 'Code Review')]

    renderBoard()
    await waitFor(() => expect(getColumn('In Review')).toBeTruthy())

    const col = getColumn('In Review')
    await waitFor(() => expect(col.querySelector('.kanban-count').textContent).toBe('2 / 3'))
    expect(col.classList.contains('kanban-col-over-wip')).toBe(false)
    expect(col.querySelector('.kanban-count').classList.contains('kanban-count-over')).toBe(false)
  })
})

describe('JL-355 — default board (column name equals status) is unchanged', () => {
  it('still flags a default column over its limit', async () => {
    mockFetchBoardConfig.mockResolvedValue({
      ...emptyConfig,
      wipLimits: { 'To Do': 1 },
    })
    mockIssues = [issue(1, 'To Do'), issue(2, 'To Do'), issue(3, 'Done')]

    renderBoard()
    await waitFor(() => expect(getColumn('To Do')).toBeTruthy())

    const col = getColumn('To Do')
    await waitFor(() => expect(col.classList.contains('kanban-col-over-wip')).toBe(true))
    expect(col.querySelector('.kanban-count').textContent).toBe('2 / 1')
    // Unlimited columns keep the bare count with no suffix or highlight.
    const done = getColumn('Done')
    expect(done.querySelector('.kanban-count').textContent).toBe('1')
    expect(done.classList.contains('kanban-col-over-wip')).toBe(false)
  })

  it('does not flag a default column within its limit', async () => {
    mockFetchBoardConfig.mockResolvedValue({
      ...emptyConfig,
      wipLimits: { 'To Do': 5 },
    })
    mockIssues = [issue(1, 'To Do'), issue(2, 'To Do')]

    renderBoard()
    await waitFor(() => expect(getColumn('To Do')).toBeTruthy())

    const col = getColumn('To Do')
    await waitFor(() => expect(col.querySelector('.kanban-count').textContent).toBe('2 / 5'))
    expect(col.classList.contains('kanban-col-over-wip')).toBe(false)
  })
})

describe('JL-355 — merged column limit is the SUM of its mapped statuses limits', () => {
  const mergedConfig = {
    ...emptyConfig,
    // "Active" merges two limited statuses: 1 + 2 → effective column limit 3.
    wipLimits: { 'In Progress': 1, 'Code Review': 2 },
    columns: [
      { id: 'c1', name: 'Ready', statuses: ['To Do'] },
      { id: 'c2', name: 'Active', statuses: ['In Progress', 'Code Review'] },
    ],
  }

  it('stays within limit at the summed capacity', async () => {
    mockFetchBoardConfig.mockResolvedValue(mergedConfig)
    mockIssues = [issue(1, 'In Progress'), issue(2, 'Code Review'), issue(3, 'Code Review')]

    renderBoard()
    await waitFor(() => expect(getColumn('Active')).toBeTruthy())

    const col = getColumn('Active')
    await waitFor(() => expect(col.querySelector('.kanban-count').textContent).toBe('3 / 3'))
    expect(col.classList.contains('kanban-col-over-wip')).toBe(false)
  })

  it('flags the merged column once the summed capacity is exceeded', async () => {
    mockFetchBoardConfig.mockResolvedValue(mergedConfig)
    mockIssues = [
      issue(1, 'In Progress'),
      issue(2, 'In Progress'),
      issue(3, 'Code Review'),
      issue(4, 'Code Review'),
    ]

    renderBoard()
    await waitFor(() => expect(getColumn('Active')).toBeTruthy())

    const col = getColumn('Active')
    await waitFor(() => expect(col.classList.contains('kanban-col-over-wip')).toBe(true))
    expect(col.querySelector('.kanban-count').textContent).toBe('4 / 3')
  })

  it('uses only the limited statuses when some mapped statuses carry no limit', async () => {
    mockFetchBoardConfig.mockResolvedValue({
      ...emptyConfig,
      // Only In Progress is limited; Code Review contributes nothing.
      wipLimits: { 'In Progress': 2 },
      columns: [{ id: 'c1', name: 'Active', statuses: ['In Progress', 'Code Review'] }],
    })
    mockIssues = [issue(1, 'In Progress'), issue(2, 'Code Review'), issue(3, 'Code Review')]

    renderBoard()
    await waitFor(() => expect(getColumn('Active')).toBeTruthy())

    const col = getColumn('Active')
    await waitFor(() => expect(col.querySelector('.kanban-count').textContent).toBe('3 / 2'))
    expect(col.classList.contains('kanban-col-over-wip')).toBe(true)
  })

  it('shows no counter or highlight when no mapped status has a limit', async () => {
    mockFetchBoardConfig.mockResolvedValue({
      ...emptyConfig,
      wipLimits: { 'To Do': 1 },
      columns: [{ id: 'c1', name: 'Active', statuses: ['In Progress', 'Code Review'] }],
    })
    mockIssues = [issue(1, 'In Progress'), issue(2, 'Code Review')]

    renderBoard()
    await waitFor(() => expect(getColumn('Active')).toBeTruthy())

    const col = getColumn('Active')
    await waitFor(() => expect(within(col).getByText('2')).toBeInTheDocument())
    expect(col.querySelector('.kanban-count').textContent).toBe('2')
    expect(col.classList.contains('kanban-col-over-wip')).toBe(false)
  })
})
