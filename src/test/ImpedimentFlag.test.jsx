// JL-215 — Flag issue as impediment: indicator on board cards + backlog rows,
// and the detail-page toggle persisting through IssueContext to the PATCH API.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { BoardPage } from '../pages/BoardPage/BoardPage'
import { BacklogIssueRow } from '../components/issues/BacklogIssueRow'
import { ImpedimentFlagToggle } from '../components/issues/ImpedimentFlag'
import { IssueProvider, useIssues } from '../context/IssueContext'

// ── Mocks ──
const mockPerms = { canEditIssue: true, canManageProjectSettings: false }
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => mockPerms,
}))

const mockUpdateIssue = vi.fn()
vi.mock('../api/issueApi', () => ({
  fetchIssues: vi.fn().mockResolvedValue([]),
  createIssue: vi.fn(),
  updateIssue: (...args) => mockUpdateIssue(...args),
  updateIssueStatus: vi.fn().mockResolvedValue({}),
  deleteIssue: vi.fn(),
}))

vi.mock('../api/boardConfigApi', () => ({
  fetchBoardConfig: vi.fn().mockResolvedValue({ projectId: 1, swimlaneBy: 'none', wipLimits: {}, quickFilters: [] }),
  saveBoardConfig: vi.fn().mockResolvedValue({}),
  ESTIMATION_STATISTIC_OPTIONS: [{ value: 'story_points', label: 'Story Points' }],
}))

// Seeds the real IssueProvider with a fixed issue list before rendering children.
function SeedIssues({ issues, children }) {
  const { issues: current, loadIssues } = useIssues()
  useEffect(() => {
    loadIssues(issues)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return current.length > 0 ? children : null
}

const flaggedIssue = { id: 1, key: 'JL-1', title: 'Blocked work', issueType: 'Story', status: 'To Do', priority: 'High', assignee: 'Alice', projectId: 1, flagged: true }
const plainIssue = { id: 2, key: 'JL-2', title: 'Normal work', issueType: 'Task', status: 'To Do', priority: 'Medium', assignee: 'Bob', projectId: 1, flagged: false }

beforeEach(() => {
  mockPerms.canEditIssue = true
  mockUpdateIssue.mockReset().mockImplementation(async (id, fields) => ({ ...flaggedIssue, id, ...fields }))
})

describe('JL-215 — board card flag indicator', () => {
  function renderBoard() {
    return render(
      <IssueProvider>
        <SeedIssues issues={[flaggedIssue, plainIssue]}>
          <MemoryRouter initialEntries={['/projects/1/board']}>
            <Routes>
              <Route path="/projects/:projectId/board" element={<BoardPage />} />
            </Routes>
          </MemoryRouter>
        </SeedIssues>
      </IssueProvider>,
    )
  }

  it('shows the flag indicator and warm tint on a flagged card only', async () => {
    renderBoard()
    await waitFor(() => expect(screen.getByText('Blocked work')).toBeInTheDocument())

    const indicators = screen.getAllByRole('img', { name: 'Flagged as impediment' })
    expect(indicators).toHaveLength(1)

    const flaggedCard = screen.getByText('Blocked work').closest('.card')
    expect(flaggedCard.classList.contains('kanban-card-flagged')).toBe(true)

    const plainCard = screen.getByText('Normal work').closest('.card')
    expect(plainCard.classList.contains('kanban-card-flagged')).toBe(false)
  })
})

describe('JL-215 — backlog row flag indicator', () => {
  const rowProps = {
    onMove: vi.fn(),
    onOpen: vi.fn(),
    isSelected: false,
    onToggleSelect: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
  }

  it('renders the flagged chip and row tint when flagged', () => {
    render(<BacklogIssueRow issue={flaggedIssue} {...rowProps} />)
    expect(screen.getByRole('img', { name: 'Flagged as impediment' })).toBeInTheDocument()
    expect(document.querySelector('.backlog-issue-row').classList.contains('backlog-issue-flagged')).toBe(true)
  })

  it('renders no flag chip when not flagged', () => {
    render(<BacklogIssueRow issue={plainIssue} {...rowProps} />)
    expect(screen.queryByRole('img', { name: 'Flagged as impediment' })).toBeNull()
    expect(document.querySelector('.backlog-issue-flagged')).toBeNull()
  })
})

describe('JL-215 — detail-page flag toggle', () => {
  function renderToggle(issue) {
    return render(
      <IssueProvider>
        <ImpedimentFlagToggle issue={issue} />
      </IssueProvider>,
    )
  }

  it('"Add flag" calls the PATCH API with flagged=true', async () => {
    renderToggle(plainIssue)
    fireEvent.click(screen.getByRole('button', { name: /add flag/i }))
    await waitFor(() => expect(mockUpdateIssue).toHaveBeenCalledWith(2, { flagged: true }))
  })

  it('"Remove flag" calls the PATCH API with flagged=false', async () => {
    renderToggle(flaggedIssue)
    fireEvent.click(screen.getByRole('button', { name: /remove flag/i }))
    await waitFor(() => expect(mockUpdateIssue).toHaveBeenCalledWith(1, { flagged: false }))
  })

  it('hides the toggle for viewers (read-only indicator when flagged)', () => {
    mockPerms.canEditIssue = false
    renderToggle(flaggedIssue)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('img', { name: 'Flagged as impediment' })).toBeInTheDocument()
  })
})
