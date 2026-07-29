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

const baseIssues = [
  { id: 1, key: 'JL-1', title: 'Setup project', issueType: 'Task', status: 'To Do', priority: 'High', assignee: 'Alice', projectId: 1 },
  { id: 2, key: 'JL-2', title: 'Fix login bug', issueType: 'Bug', status: 'To Do', priority: 'Medium', assignee: 'Bob', projectId: 1 },
  { id: 3, key: 'JL-3', title: 'Add dashboard', issueType: 'Story', status: 'In Progress', priority: 'Low', assignee: 'Alice', projectId: 1 },
  { id: 4, key: 'JL-4', title: 'Write docs', issueType: 'Task', status: 'Done', priority: 'Medium', assignee: 'Bob', projectId: 1 },
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
  mockHandleMove.mockReset().mockResolvedValue({})
  mockFetchBoardConfig.mockReset().mockResolvedValue(emptyConfig)
  mockSaveBoardConfig.mockReset().mockResolvedValue({})
})

async function openSettings() {
  renderBoard()
  await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())
  fireEvent.click(screen.getAllByText('Board settings')[0])
}

describe('JL-308 — board renders from column configuration', () => {
  it('groups issues by the configured columns and their mapped statuses', async () => {
    mockFetchBoardConfig.mockResolvedValue({
      ...emptyConfig,
      columns: [
        { id: 'c1', name: 'Ready', statuses: ['To Do'] },
        { id: 'c2', name: 'Active', statuses: ['In Progress', 'Code Review'] },
        { id: 'c3', name: 'Complete', statuses: ['Done'] },
      ],
    })
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="Ready"]')).toBeTruthy())

    // Exactly the three configured columns (not the 4 default status columns).
    expect(document.querySelectorAll('.kanban-col').length).toBe(3)

    const ready = document.querySelector('.kanban-col[data-column="Ready"]')
    expect(within(ready).getByText('Setup project')).toBeInTheDocument()
    expect(within(ready).getByText('Fix login bug')).toBeInTheDocument()

    const active = document.querySelector('.kanban-col[data-column="Active"]')
    expect(within(active).getByText('Add dashboard')).toBeInTheDocument()

    const complete = document.querySelector('.kanban-col[data-column="Complete"]')
    expect(within(complete).getByText('Write docs')).toBeInTheDocument()
    expect(within(complete).queryByText('Setup project')).toBeNull()
  })

  it('falls back to the default status columns when no config is saved', async () => {
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="To Do"]')).toBeTruthy())
    expect(document.querySelectorAll('.kanban-col').length).toBe(4)
  })
})

describe('JL-308 — column settings editor', () => {
  it('shows the default workflow columns and the unmapped area', async () => {
    await openSettings()
    // Default editor columns mirror the board columns (To Do..Done).
    expect(screen.getByLabelText('Column 1 name').value).toBe('To Do')
    expect(screen.getByLabelText('Column 4 name').value).toBe('Done')
    // Backlog is unmapped by default.
    const unmapped = document.querySelector('.board-col-unmapped')
    expect(within(unmapped).getByText('Backlog')).toBeInTheDocument()
  })

  it('adds, renames a column and assigns a status, then saves via the API', async () => {
    await openSettings()

    fireEvent.click(screen.getByText('Add column'))
    // New 5th column appears.
    const nameInput = screen.getByLabelText('Column 5 name')
    expect(nameInput.value).toBe('New column')
    fireEvent.change(nameInput, { target: { value: 'QA' } })

    // Assign the unmapped Backlog status to the new column.
    const addStatus = screen.getByLabelText('Add status to column 5')
    fireEvent.change(addStatus, { target: { value: 'Backlog' } })

    // The chip now shows under the column and Backlog leaves the unmapped area.
    await waitFor(() => {
      const editor = document.querySelector('.board-col-editor[data-col-id] .board-col-status-chip')
      expect(editor).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(mockSaveBoardConfig).toHaveBeenCalled())
    const [pid, payload] = mockSaveBoardConfig.mock.calls[0]
    expect(pid).toBe('1')
    expect(payload.columns).toHaveLength(5)
    const qa = payload.columns.find((c) => c.name === 'QA')
    expect(qa).toBeTruthy()
    expect(qa.statuses).toContain('Backlog')
  })

  it('reorders columns with the move buttons', async () => {
    await openSettings()
    expect(screen.getByLabelText('Column 1 name').value).toBe('To Do')
    // Move the second column (In Progress) left.
    fireEvent.click(screen.getByLabelText('Move column 2 left'))
    expect(screen.getByLabelText('Column 1 name').value).toBe('In Progress')
    expect(screen.getByLabelText('Column 2 name').value).toBe('To Do')
  })

  it('removes a column', async () => {
    await openSettings()
    expect(document.querySelectorAll('.board-col-editor').length).toBe(4)
    fireEvent.click(screen.getByLabelText('Remove column 1'))
    expect(document.querySelectorAll('.board-col-editor').length).toBe(3)
    // The removed column's status returns to the unmapped area.
    const unmapped = document.querySelector('.board-col-unmapped')
    expect(within(unmapped).getByText('To Do')).toBeInTheDocument()
  })

  it('moves a card to the target column status on drop', async () => {
    mockFetchBoardConfig.mockResolvedValue({
      ...emptyConfig,
      columns: [
        { id: 'c1', name: 'Ready', statuses: ['To Do'] },
        { id: 'c2', name: 'Active', statuses: ['In Progress', 'Code Review'] },
      ],
    })
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="Active"]')).toBeTruthy())

    const ready = document.querySelector('.kanban-col[data-column="Ready"]')
    const card = within(ready).getByText('Setup project').closest('.card')
    fireEvent.dragStart(card)
    const active = document.querySelector('.kanban-col[data-column="Active"]')
    fireEvent.dragOver(active)
    fireEvent.drop(active)

    await waitFor(() => expect(mockHandleMove).toHaveBeenCalled())
    // Dropped onto Active → first mapped status is 'In Progress'.
    expect(mockHandleMove).toHaveBeenCalledWith(1, 'In Progress', null)
  })
})
