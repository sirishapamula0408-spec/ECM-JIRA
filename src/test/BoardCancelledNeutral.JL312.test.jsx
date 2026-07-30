import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { BoardPage } from '../pages/BoardPage/BoardPage'

// ── Mock contexts / hooks / api (mirrors BoardDoneColumnColor.JL311) ──
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

const issues = [
  { id: 1, key: 'JL-1', title: 'Setup project', issueType: 'Task', status: 'To Do', priority: 'High', assignee: 'Alice', projectId: 1 },
  { id: 2, key: 'JL-2', title: 'Write docs', issueType: 'Task', status: 'Done', priority: 'Medium', assignee: 'Bob', projectId: 1 },
  { id: 3, key: 'JL-3', title: 'Old idea', issueType: 'Story', status: 'Cancelled', priority: 'Low', assignee: 'Alice', projectId: 1 },
]

// JL-312: "Cancelled" is done-category (terminal) but must NOT render green.
const statusRows = [
  { id: 10, project_id: 1, name: 'Backlog', position: 0, color: '#42526E', category: 'todo' },
  { id: 11, project_id: 1, name: 'To Do', position: 1, color: '#42526E', category: 'todo' },
  { id: 12, project_id: 1, name: 'In Progress', position: 2, color: '#0052CC', category: 'inprogress' },
  { id: 13, project_id: 1, name: 'Done', position: 3, color: '#00875A', category: 'done' },
  { id: 14, project_id: 1, name: 'Cancelled', position: 4, color: '#00875A', category: 'done' },
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
  mockIssues = [...issues]
  mockHandleMove.mockReset().mockResolvedValue({})
  mockFetchBoardConfig.mockReset().mockResolvedValue(emptyConfig)
  mockSaveBoardConfig.mockReset().mockResolvedValue({})
  mockFetchProjectStatuses.mockReset().mockResolvedValue(statusRows)
})

describe('JL-312 — Cancelled column stays neutral (not green)', () => {
  it('keeps the Cancelled (done-category) column neutral while Done stays green', async () => {
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="Cancelled"]')).toBeTruthy())

    // "Cancelled" is category=done but a cancellation status → NO green accent.
    const cancelled = document.querySelector('.kanban-col[data-column="Cancelled"]')
    expect(cancelled.classList.contains('kanban-col-cat-done')).toBe(false)
    expect(cancelled.classList.contains('kanban-col-cat-inprogress')).toBe(false)

    // "Done" keeps the green accent exactly as JL-311.
    const done = document.querySelector('.kanban-col[data-column="Done"]')
    expect(done.classList.contains('kanban-col-cat-done')).toBe(true)

    // "In Progress" keeps the blue accent.
    const inProgress = document.querySelector('.kanban-col[data-column="In Progress"]')
    expect(inProgress.classList.contains('kanban-col-cat-inprogress')).toBe(true)
  })

  it('treats the US spelling "Canceled" as neutral too', async () => {
    mockIssues = [
      { id: 1, key: 'JL-1', title: 'Old idea', issueType: 'Story', status: 'Canceled', priority: 'Low', assignee: 'Alice', projectId: 1 },
    ]
    mockFetchProjectStatuses.mockResolvedValue([
      { id: 10, project_id: 1, name: 'Backlog', position: 0, color: '#42526E', category: 'todo' },
      { id: 11, project_id: 1, name: 'Done', position: 1, color: '#00875A', category: 'done' },
      { id: 12, project_id: 1, name: 'Canceled', position: 2, color: '#00875A', category: 'done' },
    ])
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="Canceled"]')).toBeTruthy())

    const canceled = document.querySelector('.kanban-col[data-column="Canceled"]')
    expect(canceled.classList.contains('kanban-col-cat-done')).toBe(false)

    const done = document.querySelector('.kanban-col[data-column="Done"]')
    expect(done.classList.contains('kanban-col-cat-done')).toBe(true)
  })
})
