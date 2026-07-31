import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { BoardPage } from '../pages/BoardPage/BoardPage'

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: mockIssues, handleMove: vi.fn() }),
}))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ canManageProjectSettings: true, canEditIssue: true }),
}))
const mockFetchBoardConfig = vi.fn()
const mockSaveBoardConfig = vi.fn()
vi.mock('../api/boardConfigApi', () => ({
  fetchBoardConfig: (...a) => mockFetchBoardConfig(...a),
  saveBoardConfig: (...a) => mockSaveBoardConfig(...a),
  ESTIMATION_STATISTIC_OPTIONS: [
    { value: 'story_points', label: 'Story Points' },
    { value: 'issue_count', label: 'Issue Count' },
  ],
}))

let mockIssues = []
const baseIssues = [
  { id: 1, key: 'JL-1', title: 'A', issueType: 'Task', status: 'To Do', priority: 'High', assignee: 'Alice', projectId: 1 },
  { id: 2, key: 'JL-2', title: 'B', issueType: 'Story', status: 'In Progress', priority: 'Low', assignee: 'Bob', projectId: 1 },
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
  mockIssues = [...baseIssues]
  mockFetchBoardConfig.mockReset().mockResolvedValue(emptyConfig)
  mockSaveBoardConfig.mockReset().mockResolvedValue({})
})

/* ================================================================
   JL-319: the "Board settings" toggle carries a text label and must be
   the labelled toggle (class board-settings-toggle) — not squeezed into
   the fixed 34x34 icon-button size. Guards the element's identity + the
   full, un-clipped label + open behaviour. (Pixel width is verified in
   the browser; jsdom has no layout.)
   ================================================================ */
describe('JL-319 — Board settings label/button', () => {
  it('renders the labelled "Board settings" toggle with the board-settings-toggle class and full text', async () => {
    const { container } = renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())

    const toggle = container.querySelector('button.board-settings-toggle')
    expect(toggle).toBeTruthy()
    // full, single, un-split label
    expect(toggle.textContent.trim()).toBe('Board settings')
    // it is a real icon-button variant but the label one, distinct from the "…" button
    expect(toggle.classList.contains('board-jira-action-btn')).toBe(true)
  })

  it('opens the Board settings panel when the toggle is clicked', async () => {
    const { container } = renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())

    fireEvent.click(container.querySelector('button.board-settings-toggle'))
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Board settings/i })).toBeTruthy()
    })
  })
})
