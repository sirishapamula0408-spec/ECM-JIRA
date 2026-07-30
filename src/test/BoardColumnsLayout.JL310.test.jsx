import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { BoardPage } from '../pages/BoardPage/BoardPage'

// ── Mock contexts / hooks / api ──
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

const mockFetchProjectStatuses = vi.fn()
vi.mock('../api/issueConfigApi', () => ({
  fetchProjectStatuses: (...args) => mockFetchProjectStatuses(...args),
}))

let mockIssues = []

// A QA-lifecycle workflow with MANY statuses — exactly the wrapping case JL-310 fixes.
const qaStatusRows = [
  { id: 10, project_id: 1, name: 'Backlog', position: 0, category: 'todo' },
  { id: 11, project_id: 1, name: 'To Do', position: 1, category: 'todo' },
  { id: 12, project_id: 1, name: 'In Progress', position: 2, category: 'inprogress' },
  { id: 13, project_id: 1, name: 'In Testing', position: 3, category: 'inprogress' },
  { id: 14, project_id: 1, name: 'In Rework', position: 4, category: 'inprogress' },
  { id: 15, project_id: 1, name: 'In UAT', position: 5, category: 'inprogress' },
  { id: 16, project_id: 1, name: 'Done', position: 6, category: 'done' },
  { id: 17, project_id: 1, name: 'Cancelled', position: 7, category: 'done' },
]
// Non-backlog statuses become the default columns (7 of them).
const qaColumnCount = qaStatusRows.length - 1

const qaIssues = [
  { id: 1, key: 'JL-1', title: 'Login test', issueType: 'Task', status: 'In Testing', priority: 'High', assignee: 'Alice', projectId: 1 },
  { id: 2, key: 'JL-2', title: 'UAT signoff', issueType: 'Story', status: 'In UAT', priority: 'Low', assignee: 'Bob', projectId: 1 },
]

const emptyConfig = { projectId: 1, swimlaneBy: 'none', wipLimits: {}, quickFilters: [], estimationStatistic: 'story_points', columns: [] }

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/board']}>
      <Routes>
        <Route path="/projects/:projectId/board" element={<BoardPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockIssues = [...qaIssues]
  mockHandleMove.mockReset().mockResolvedValue({})
  mockFetchBoardConfig.mockReset().mockResolvedValue(emptyConfig)
  mockSaveBoardConfig.mockReset().mockResolvedValue({})
  mockFetchProjectStatuses.mockReset().mockResolvedValue(qaStatusRows)
  window.localStorage.clear()
})

describe('JL-310 — single-row board layout', () => {
  it('renders all configured columns as direct siblings in a single columns container', async () => {
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="In Testing"]')).toBeTruthy())

    // Exactly one columns container (the single row) for the single (no-swimlane) lane.
    const grids = document.querySelectorAll('.kanban-grid')
    expect(grids.length).toBe(1)
    const grid = grids[0]

    // All 7 non-backlog QA statuses render as DIRECT children of that one row —
    // i.e. one horizontal row, not split/wrapped across multiple containers.
    const cols = grid.querySelectorAll(':scope > .kanban-col')
    expect(cols.length).toBe(qaColumnCount)
    expect(document.querySelectorAll('.kanban-col').length).toBe(qaColumnCount)
    expect(grid.querySelector(':scope > .kanban-col[data-column="In Rework"]')).toBeTruthy()
    expect(grid.querySelector(':scope > .kanban-col[data-column="Cancelled"]')).toBeTruthy()
  })

  it('gives every column a resize handle without breaking card drag-and-drop', async () => {
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="In Testing"]')).toBeTruthy())

    // One resize handle per column.
    expect(document.querySelectorAll('.kanban-col-resize-handle').length).toBe(qaColumnCount)

    // Cards remain draggable (DnD attributes intact).
    const card = document.querySelector('.kanban-card-draggable')
    expect(card).toBeTruthy()
    expect(card.getAttribute('draggable')).toBe('true')
    // The resize handle must not be draggable (so it never hijacks card DnD).
    const handle = document.querySelector('.kanban-col-resize-handle')
    expect(handle.getAttribute('draggable')).toBe('false')
  })
})

describe('JL-310 — resizable column widths persist in localStorage', () => {
  it('persists a dragged width to localStorage and applies it on the column', async () => {
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="In Testing"]')).toBeTruthy())

    const col = document.querySelector('.kanban-col[data-column="In Testing"]')
    const handle = col.querySelector('.kanban-col-resize-handle')

    // Simulate a resize drag: pointer down on the handle, move right, release.
    fireEvent.pointerDown(handle, { clientX: 300 })
    fireEvent.pointerMove(window, { clientX: 420 }) // +120px
    fireEvent.pointerUp(window, { clientX: 420 })

    // localStorage now holds a width for this board keyed per project.
    const stored = JSON.parse(window.localStorage.getItem('board_col_widths_1'))
    expect(stored).toBeTruthy()
    const widths = Object.values(stored)
    expect(widths.length).toBe(1)
    // jsdom reports 0 for getBoundingClientRect width, so the applied width is
    // clamped to the MIN_COL_WIDTH (200) rather than growing from a real size.
    expect(widths[0]).toBeGreaterThanOrEqual(200)

    // The width is reflected as an inline style on the column element.
    expect(col.style.width).not.toBe('')
  })

  it('restores a persisted width on load and applies it to the matching column', async () => {
    // Pre-seed a stored width for the default "In UAT" column (its id is the status name).
    window.localStorage.setItem('board_col_widths_1', JSON.stringify({ 'In UAT': 333 }))

    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="In UAT"]')).toBeTruthy())

    const col = document.querySelector('.kanban-col[data-column="In UAT"]')
    expect(col.style.width).toBe('333px')
    expect(col.style.flex).toContain('333px')

    // Columns without a stored width keep their default (no inline width).
    const other = document.querySelector('.kanban-col[data-column="In Testing"]')
    expect(other.style.width).toBe('')
  })
})
