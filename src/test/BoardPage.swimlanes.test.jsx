import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { BoardPage } from '../pages/BoardPage/BoardPage'

// ── Mock contexts / hooks / api ──
const mockHandleMove = vi.fn()

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: mockIssues, handleMove: mockHandleMove }),
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ canManageProjectSettings: true }),
}))

const mockFetchBoardConfig = vi.fn()
const mockSaveBoardConfig = vi.fn()
vi.mock('../api/boardConfigApi', () => ({
  fetchBoardConfig: (...args) => mockFetchBoardConfig(...args),
  saveBoardConfig: (...args) => mockSaveBoardConfig(...args),
}))

let mockIssues = []

const baseIssues = [
  { id: 1, key: 'JL-1', title: 'Setup project', issueType: 'Task', status: 'To Do', priority: 'High', assignee: 'Alice', projectId: 1 },
  { id: 2, key: 'JL-2', title: 'Fix login bug', issueType: 'Bug', status: 'To Do', priority: 'Medium', assignee: 'Bob', projectId: 1 },
  { id: 3, key: 'JL-3', title: 'Add dashboard', issueType: 'Story', status: 'In Progress', priority: 'Low', assignee: 'Alice', projectId: 1 },
  { id: 4, key: 'JL-4', title: 'Write docs', issueType: 'Task', status: 'Done', priority: 'Medium', assignee: 'Bob', projectId: 1 },
]

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
  mockHandleMove.mockReset().mockResolvedValue({})
  mockFetchBoardConfig.mockReset().mockResolvedValue({ projectId: 1, swimlaneBy: 'none', wipLimits: {}, quickFilters: [] })
  mockSaveBoardConfig.mockReset().mockResolvedValue({})
})

describe('BoardPage — swimlanes', () => {
  it('renders a single lane (no swimlanes) by default', async () => {
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalledWith('1'))
    // No swimlane labels rendered in "none" mode
    expect(document.querySelector('.board-swimlane-label')).toBeNull()
    expect(screen.getByText('Setup project')).toBeInTheDocument()
  })

  it('groups issues into swimlanes by assignee when selected', async () => {
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())

    const swimlaneSelect = screen.getByLabelText('Swimlanes')
    fireEvent.change(swimlaneSelect, { target: { value: 'assignee' } })

    // Two swimlanes: Alice and Bob
    const lanes = document.querySelectorAll('.board-swimlane[data-swimlane]')
    const laneKeys = Array.from(lanes).map((el) => el.getAttribute('data-swimlane'))
    expect(laneKeys).toContain('Alice')
    expect(laneKeys).toContain('Bob')

    // Alice lane contains only Alice's issues
    const aliceLane = document.querySelector('.board-swimlane[data-swimlane="Alice"]')
    expect(within(aliceLane).getByText('Setup project')).toBeInTheDocument()
    expect(within(aliceLane).getByText('Add dashboard')).toBeInTheDocument()
    expect(within(aliceLane).queryByText('Fix login bug')).toBeNull()

    // Bob lane contains only Bob's issues
    const bobLane = document.querySelector('.board-swimlane[data-swimlane="Bob"]')
    expect(within(bobLane).getByText('Fix login bug')).toBeInTheDocument()
    expect(within(bobLane).queryByText('Setup project')).toBeNull()
  })
})

describe('BoardPage — quick filters', () => {
  it('narrows visible issues when a quick filter chip is toggled', async () => {
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())

    // All issues visible initially
    expect(screen.getByText('Setup project')).toBeInTheDocument()
    expect(screen.getByText('Fix login bug')).toBeInTheDocument()

    // Click the "Alice" assignee chip
    const aliceChip = screen.getByRole('button', { name: 'Alice' })
    fireEvent.click(aliceChip)

    // Only Alice's issues remain
    expect(screen.getByText('Setup project')).toBeInTheDocument()
    expect(screen.getByText('Add dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Fix login bug')).toBeNull()
    expect(screen.queryByText('Write docs')).toBeNull()
  })

  it('filters by issue type', async () => {
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())

    const bugChip = screen.getByRole('button', { name: 'Bug' })
    fireEvent.click(bugChip)

    expect(screen.getByText('Fix login bug')).toBeInTheDocument()
    expect(screen.queryByText('Setup project')).toBeNull()
  })
})

describe('BoardPage — WIP limits', () => {
  it('flags a column whose count exceeds its WIP limit', async () => {
    // "To Do" has 2 issues; limit is 1 -> over limit
    mockFetchBoardConfig.mockResolvedValue({ projectId: 1, swimlaneBy: 'none', wipLimits: { 'To Do': 1 }, quickFilters: [] })
    renderBoard()

    await waitFor(() => {
      const todoCount = document.querySelector('.kanban-count[data-status="To Do"]')
      expect(todoCount).toBeTruthy()
      expect(todoCount.classList.contains('kanban-count-over')).toBe(true)
    })

    // The column article also gets the over-wip class
    const todoCount = document.querySelector('.kanban-count[data-status="To Do"]')
    const col = todoCount.closest('.kanban-col')
    expect(col.classList.contains('kanban-col-over-wip')).toBe(true)
    // Header shows "2 / 1"
    expect(todoCount.textContent).toBe('2 / 1')
  })

  it('does not flag a column within its WIP limit', async () => {
    mockFetchBoardConfig.mockResolvedValue({ projectId: 1, swimlaneBy: 'none', wipLimits: { 'To Do': 5 }, quickFilters: [] })
    renderBoard()

    await waitFor(() => {
      const todoCount = document.querySelector('.kanban-count[data-status="To Do"]')
      expect(todoCount.textContent).toBe('2 / 5')
    })
    const todoCount = document.querySelector('.kanban-count[data-status="To Do"]')
    expect(todoCount.classList.contains('kanban-count-over')).toBe(false)
  })
})

describe('BoardPage — settings persistence', () => {
  it('saves board config via the API when Save is clicked', async () => {
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())

    // Open the settings panel (there are two "Board settings" buttons — the toggle is first)
    fireEvent.click(screen.getAllByText('Board settings')[0])

    const wipInput = screen.getByLabelText('WIP limit for In Progress')
    fireEvent.change(wipInput, { target: { value: '3' } })

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(mockSaveBoardConfig).toHaveBeenCalled())
    const [pid, payload] = mockSaveBoardConfig.mock.calls[0]
    expect(pid).toBe('1')
    expect(payload.wipLimits['In Progress']).toBe(3)
  })
})
