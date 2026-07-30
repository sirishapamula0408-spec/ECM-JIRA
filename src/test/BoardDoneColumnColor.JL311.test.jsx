import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { BoardPage } from '../pages/BoardPage/BoardPage'

// ── Mock contexts / hooks / api (mirrors BoardColumnsProjectStatuses.JL309) ──
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

// JL-309: project workflow statuses (with category) source the coloring.
const mockFetchProjectStatuses = vi.fn()
vi.mock('../api/issueConfigApi', () => ({
  fetchProjectStatuses: (...args) => mockFetchProjectStatuses(...args),
}))

let mockIssues = []

const customIssues = [
  { id: 1, key: 'JL-1', title: 'Setup project', issueType: 'Task', status: 'Selected', priority: 'High', assignee: 'Alice', projectId: 1 },
  { id: 2, key: 'JL-2', title: 'Fix login bug', issueType: 'Bug', status: 'Building', priority: 'Medium', assignee: 'Bob', projectId: 1 },
  { id: 3, key: 'JL-3', title: 'Add dashboard', issueType: 'Story', status: 'Shipped', priority: 'Low', assignee: 'Alice', projectId: 1 },
]

const defaultIssues = [
  { id: 1, key: 'JL-1', title: 'Setup project', issueType: 'Task', status: 'To Do', priority: 'High', assignee: 'Alice', projectId: 1 },
  { id: 2, key: 'JL-2', title: 'Add dashboard', issueType: 'Story', status: 'In Progress', priority: 'Low', assignee: 'Alice', projectId: 1 },
  { id: 3, key: 'JL-3', title: 'Write docs', issueType: 'Task', status: 'Done', priority: 'Medium', assignee: 'Bob', projectId: 1 },
]

// GET /api/projects/:id/statuses rows carry a `category` (todo/inprogress/done).
const customStatusRows = [
  { id: 10, project_id: 1, name: 'Backlog', position: 0, color: '#42526E', category: 'todo' },
  { id: 11, project_id: 1, name: 'Selected', position: 1, color: '#42526E', category: 'todo' },
  { id: 12, project_id: 1, name: 'Building', position: 2, color: '#0052CC', category: 'inprogress' },
  { id: 13, project_id: 1, name: 'Shipped', position: 3, color: '#00875A', category: 'done' },
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
  mockIssues = [...customIssues]
  mockHandleMove.mockReset().mockResolvedValue({})
  mockFetchBoardConfig.mockReset().mockResolvedValue(emptyConfig)
  mockSaveBoardConfig.mockReset().mockResolvedValue({})
  mockFetchProjectStatuses.mockReset().mockResolvedValue(customStatusRows)
})

describe('JL-311 — Done column renders green via category-based coloring', () => {
  it('applies the done (green) class to a column mapped to a done-category status', async () => {
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="Shipped"]')).toBeTruthy())

    // "Shipped" is category=done → green accent class.
    const shipped = document.querySelector('.kanban-col[data-column="Shipped"]')
    expect(shipped.classList.contains('kanban-col-cat-done')).toBe(true)

    // A todo-category column must NOT be green.
    const selected = document.querySelector('.kanban-col[data-column="Selected"]')
    expect(selected.classList.contains('kanban-col-cat-done')).toBe(false)
    expect(selected.classList.contains('kanban-col-cat-inprogress')).toBe(false)

    // In-progress column gets the (optional) blue accent, never the green one.
    const building = document.querySelector('.kanban-col[data-column="Building"]')
    expect(building.classList.contains('kanban-col-cat-inprogress')).toBe(true)
    expect(building.classList.contains('kanban-col-cat-done')).toBe(false)
  })

  it('colors the default (unconfigured) board Done column green by status name', async () => {
    // No custom statuses → falls back to ISSUE_STATUSES with no category info;
    // the column category is inferred from the status name.
    mockIssues = [...defaultIssues]
    mockFetchProjectStatuses.mockResolvedValue([])
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="Done"]')).toBeTruthy())

    const done = document.querySelector('.kanban-col[data-column="Done"]')
    expect(done.classList.contains('kanban-col-cat-done')).toBe(true)

    const todo = document.querySelector('.kanban-col[data-column="To Do"]')
    expect(todo.classList.contains('kanban-col-cat-done')).toBe(false)
  })
})
