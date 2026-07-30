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

// JL-239: label catalog + per-issue labels
const mockFetchProjectLabels = vi.fn()
const mockFetchIssueLabels = vi.fn()
vi.mock('../api/labelApi', () => ({
  fetchProjectLabels: (...args) => mockFetchProjectLabels(...args),
  fetchIssueLabels: (...args) => mockFetchIssueLabels(...args),
}))

let mockIssues = []

const baseIssues = [
  { id: 1, key: 'JL-1', title: 'Setup project', issueType: 'Task', status: 'To Do', priority: 'High', assignee: 'Alice', projectId: 1 },
  { id: 2, key: 'JL-2', title: 'Fix login bug', issueType: 'Bug', status: 'To Do', priority: 'Medium', assignee: 'Bob', projectId: 1 },
  { id: 3, key: 'JL-3', title: 'Add dashboard', issueType: 'Story', status: 'In Progress', priority: 'Low', assignee: 'Alice', projectId: 1 },
  { id: 4, key: 'JL-4', title: 'Write docs', issueType: 'Task', status: 'Done', priority: 'Medium', assignee: 'Bob', projectId: 1 },
]

// frontend label lives on issues 1 & 3; backend label on issue 2.
const issueLabelMap = {
  1: [{ id: 10, name: 'frontend', color: '#0052cc' }],
  2: [{ id: 11, name: 'backend', color: '#36b37e' }],
  3: [{ id: 10, name: 'frontend', color: '#0052cc' }],
  4: [],
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

beforeEach(() => {
  window.localStorage.clear()
  mockIssues = [...baseIssues]
  mockHandleMove.mockReset().mockResolvedValue({})
  mockFetchBoardConfig.mockReset().mockResolvedValue({ projectId: 1, swimlaneBy: 'none', wipLimits: {}, quickFilters: [], estimationStatistic: 'story_points' })
  mockSaveBoardConfig.mockReset().mockResolvedValue({})
  mockFetchProjectLabels.mockReset().mockResolvedValue([
    { id: 10, name: 'frontend', color: '#0052cc' },
    { id: 11, name: 'backend', color: '#36b37e' },
  ])
  mockFetchIssueLabels.mockReset().mockImplementation((id) => Promise.resolve(issueLabelMap[id] || []))
})

describe('BoardPage — JL-239 filter persistence', () => {
  it('restores the active quick-filter selection after remount (reload)', async () => {
    const { unmount } = renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())

    // Activate the "Alice" assignee filter.
    fireEvent.click(screen.getByRole('button', { name: 'Alice' }))
    expect(screen.queryByText('Fix login bug')).toBeNull()

    // Selection should be written to localStorage keyed per board.
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('jira_board_filters_1') || '[]')
      expect(stored).toContain('assignee:Alice')
    })

    // Remount the board (simulates a reload).
    unmount()
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())

    // The Alice chip is restored active and Bob's issues stay filtered out.
    await waitFor(() => {
      const aliceChip = screen.getByRole('button', { name: 'Alice' })
      expect(aliceChip.getAttribute('aria-pressed')).toBe('true')
    })
    expect(screen.getByText('Setup project')).toBeInTheDocument()
    expect(screen.queryByText('Fix login bug')).toBeNull()
    expect(screen.queryByText('Write docs')).toBeNull()
  })
})

describe('BoardPage — JL-239 label filtering', () => {
  it('renders label chips from the project catalog and filters by label', async () => {
    renderBoard()
    await waitFor(() => expect(mockFetchProjectLabels).toHaveBeenCalledWith('1'))

    // Label chips render.
    const frontendChip = await screen.findByRole('button', { name: 'frontend' })
    expect(screen.getByRole('button', { name: 'backend' })).toBeInTheDocument()

    // Wait for per-issue label data to load.
    await waitFor(() => expect(mockFetchIssueLabels).toHaveBeenCalled())

    // Filter by the "frontend" label -> only issues 1 & 3.
    fireEvent.click(frontendChip)
    await waitFor(() => expect(screen.queryByText('Fix login bug')).toBeNull())
    expect(screen.getByText('Setup project')).toBeInTheDocument()
    expect(screen.getByText('Add dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Write docs')).toBeNull()
  })
})

describe('BoardPage — JL-239 text filtering', () => {
  it('filters issues by summary/key with the debounced text input', async () => {
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())

    const input = screen.getByLabelText('Filter issues by text')

    // Search by summary text.
    fireEvent.change(input, { target: { value: 'login' } })
    await waitFor(() => expect(screen.queryByText('Setup project')).toBeNull())
    expect(screen.getByText('Fix login bug')).toBeInTheDocument()

    // Search by issue key.
    fireEvent.change(input, { target: { value: 'JL-3' } })
    await waitFor(() => expect(screen.getByText('Add dashboard')).toBeInTheDocument())
    expect(screen.queryByText('Fix login bug')).toBeNull()
    expect(screen.queryByText('Setup project')).toBeNull()
  })
})
