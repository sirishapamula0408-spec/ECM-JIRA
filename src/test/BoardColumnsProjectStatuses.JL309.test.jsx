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

// JL-309: project workflow statuses source the columns editor + board grouping.
const mockFetchProjectStatuses = vi.fn()
vi.mock('../api/issueConfigApi', () => ({
  fetchProjectStatuses: (...args) => mockFetchProjectStatuses(...args),
}))

let mockIssues = []

// Issues whose statuses match a CUSTOM workflow (Selected / Building / Shipped).
const customIssues = [
  { id: 1, key: 'JL-1', title: 'Setup project', issueType: 'Task', status: 'Selected', priority: 'High', assignee: 'Alice', projectId: 1 },
  { id: 2, key: 'JL-2', title: 'Fix login bug', issueType: 'Bug', status: 'Building', priority: 'Medium', assignee: 'Bob', projectId: 1 },
  { id: 3, key: 'JL-3', title: 'Add dashboard', issueType: 'Story', status: 'Shipped', priority: 'Low', assignee: 'Alice', projectId: 1 },
]

// Issues on the standard workflow (To Do / In Progress / Done).
const defaultIssues = [
  { id: 1, key: 'JL-1', title: 'Setup project', issueType: 'Task', status: 'To Do', priority: 'High', assignee: 'Alice', projectId: 1 },
  { id: 2, key: 'JL-2', title: 'Add dashboard', issueType: 'Story', status: 'In Progress', priority: 'Low', assignee: 'Alice', projectId: 1 },
  { id: 3, key: 'JL-3', title: 'Write docs', issueType: 'Task', status: 'Done', priority: 'Medium', assignee: 'Bob', projectId: 1 },
]

// Response shape from GET /api/projects/:id/statuses — { id, name, position, color, category }.
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

async function openSettings() {
  renderBoard()
  await waitFor(() => expect(mockFetchProjectStatuses).toHaveBeenCalled())
  fireEvent.click(screen.getAllByText('Board settings')[0])
}

describe('JL-309 — columns editor sources statuses from the project workflow', () => {
  it('lists the project custom statuses (not the hardcoded set) in the editor', async () => {
    await openSettings()
    // Default editor columns mirror the project's non-backlog statuses.
    await waitFor(() => expect(screen.getByLabelText('Column 1 name').value).toBe('Selected'))
    expect(screen.getByLabelText('Column 2 name').value).toBe('Building')
    expect(screen.getByLabelText('Column 3 name').value).toBe('Shipped')
    // The hardcoded default statuses must NOT appear as columns.
    expect(screen.queryByDisplayValue('To Do')).toBeNull()
    expect(screen.queryByDisplayValue('In Progress')).toBeNull()
    // Backlog (a project status not mapped by default) sits in the unmapped area.
    const unmapped = document.querySelector('.board-col-unmapped')
    expect(within(unmapped).getByText('Backlog')).toBeInTheDocument()
  })

  it('offers the project statuses as assignable chips when adding a status to a column', async () => {
    await openSettings()
    await waitFor(() => expect(screen.getByLabelText('Column 1 name').value).toBe('Selected'))
    // The only unmapped status is Backlog, so the add-status select offers it.
    const addStatus = screen.getByLabelText('Add status to column 1')
    expect(within(addStatus).getByRole('option', { name: 'Backlog' })).toBeInTheDocument()
    // Hardcoded statuses are not offered.
    expect(within(addStatus).queryByRole('option', { name: 'To Do' })).toBeNull()
  })

  it('falls back to the default status set when the project has no custom statuses (empty response)', async () => {
    mockFetchProjectStatuses.mockResolvedValue([])
    await openSettings()
    await waitFor(() => expect(screen.getByLabelText('Column 1 name').value).toBe('To Do'))
    expect(screen.getByLabelText('Column 4 name').value).toBe('Done')
    const unmapped = document.querySelector('.board-col-unmapped')
    expect(within(unmapped).getByText('Backlog')).toBeInTheDocument()
  })

  it('falls back to the default status set when the statuses fetch fails', async () => {
    mockFetchProjectStatuses.mockRejectedValue(new Error('network'))
    await openSettings()
    await waitFor(() => expect(screen.getByLabelText('Column 1 name').value).toBe('To Do'))
    expect(screen.getByLabelText('Column 4 name').value).toBe('Done')
  })
})

describe('JL-309 — board grouping uses the project workflow statuses', () => {
  it('renders one default column per non-backlog project status and groups issues into them', async () => {
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="Selected"]')).toBeTruthy())

    // Three custom columns (Selected/Building/Shipped) — not the 4 default columns.
    expect(document.querySelectorAll('.kanban-col').length).toBe(3)
    expect(document.querySelector('.kanban-col[data-column="To Do"]')).toBeNull()

    const selected = document.querySelector('.kanban-col[data-column="Selected"]')
    expect(within(selected).getByText('Setup project')).toBeInTheDocument()
    const building = document.querySelector('.kanban-col[data-column="Building"]')
    expect(within(building).getByText('Fix login bug')).toBeInTheDocument()
    const shipped = document.querySelector('.kanban-col[data-column="Shipped"]')
    expect(within(shipped).getByText('Add dashboard')).toBeInTheDocument()
  })

  it('exposes the project statuses in the per-card status dropdown', async () => {
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="Selected"]')).toBeTruthy())
    const selected = document.querySelector('.kanban-col[data-column="Selected"]')
    const card = within(selected).getByText('Setup project').closest('.card')
    const dropdown = within(card).getByRole('combobox')
    expect(within(dropdown).getByRole('option', { name: 'Building' })).toBeInTheDocument()
    expect(within(dropdown).getByRole('option', { name: 'Shipped' })).toBeInTheDocument()
    expect(within(dropdown).queryByRole('option', { name: 'Code Review' })).toBeNull()
  })

  it('still renders the standard default columns when statuses fall back', async () => {
    mockIssues = [...defaultIssues]
    mockFetchProjectStatuses.mockResolvedValue([])
    renderBoard()
    await waitFor(() => expect(document.querySelector('.kanban-col[data-column="To Do"]')).toBeTruthy())
    expect(document.querySelectorAll('.kanban-col').length).toBe(4)
  })
})
