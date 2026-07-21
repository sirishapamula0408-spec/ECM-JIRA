// JL-285 — RBAC: Viewer read-only Board & Active Sprint. Card drag, per-card
// status change, "Complete sprint" and "Delete board" are gated behind
// usePermissions (canEditIssue / canManageSprints / canManageProjectSettings);
// Viewers keep full read access, Members get edit affordances, Admins get
// everything.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// ── Permission mock (mutated per test) ──
let mockPerms = {}
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => mockPerms,
}))

// ── Context mocks ──
const mockHandleMove = vi.fn()
vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: mockIssues, handleMove: mockHandleMove, reloadIssues: vi.fn() }),
}))

const mockHandleCompleteSprint = vi.fn()
const mockHandleUpdateSprint = vi.fn()
vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({
    sprints: mockSprints,
    handleCompleteSprint: mockHandleCompleteSprint,
    handleUpdateSprint: mockHandleUpdateSprint,
  }),
}))

// ── API mocks ──
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

vi.mock('../api/sprintApi', () => ({
  fetchParallelSprintSetting: vi.fn().mockResolvedValue({ allowParallelSprints: false }),
  setParallelSprintSetting: vi.fn().mockResolvedValue({ allowParallelSprints: false }),
  fetchRetros: vi.fn().mockResolvedValue([]),
  addRetro: vi.fn(),
  deleteRetro: vi.fn(),
}))

import { BoardPage } from '../pages/BoardPage/BoardPage'
import { ActiveSprintPage } from '../pages/ActiveSprintPage/ActiveSprintPage'

let mockIssues = []
let mockSprints = []

const baseIssues = [
  { id: 1, key: 'JL-1', title: 'Setup project', issueType: 'Task', status: 'To Do', priority: 'High', assignee: 'Alice', projectId: 1, sprintId: 1 },
  { id: 2, key: 'JL-2', title: 'Fix login bug', issueType: 'Bug', status: 'In Progress', priority: 'Medium', assignee: 'Bob', projectId: 1, sprintId: 1 },
]

const baseSprint = { id: 1, name: 'Sprint 1', dateRange: 'Mar 1 - Mar 15', isStarted: true }

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/board']}>
      <Routes>
        <Route path="/projects/:projectId/board" element={<BoardPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderActiveSprint() {
  return render(
    <MemoryRouter initialEntries={['/active-sprint']}>
      <ActiveSprintPage />
    </MemoryRouter>,
  )
}

const VIEWER_PERMS = { loaded: true, canEditIssue: false, canManageSprints: false, canManageProjectSettings: false }
const MEMBER_PERMS = { loaded: true, canEditIssue: true, canManageSprints: false, canManageProjectSettings: false }
const ADMIN_PERMS = { loaded: true, canEditIssue: true, canManageSprints: true, canManageProjectSettings: true }

beforeEach(() => {
  mockIssues = baseIssues.map((issue) => ({ ...issue }))
  mockSprints = [{ ...baseSprint }]
  mockHandleMove.mockReset().mockResolvedValue({})
  mockHandleCompleteSprint.mockReset().mockResolvedValue({})
  mockHandleUpdateSprint.mockReset().mockResolvedValue({})
  mockFetchBoardConfig.mockReset().mockResolvedValue({ projectId: 1, swimlaneBy: 'none', wipLimits: {}, quickFilters: [] })
  mockSaveBoardConfig.mockReset().mockResolvedValue({})
})

describe('JL-285 — Viewer sees read-only Board & Active Sprint', () => {
  beforeEach(() => { mockPerms = { ...VIEWER_PERMS } })

  it('board cards are not draggable and show status as read-only text', async () => {
    renderBoard()
    await screen.findByText('Setup project')
    const card = screen.getByText('Setup project').closest('.card')
    expect(card.getAttribute('draggable')).toBe('false')
    expect(card.querySelector('select')).toBeNull()
    expect(card.querySelector('.kanban-status-readonly')).toHaveTextContent('To Do')
  })

  it('hides the Delete board menu item', async () => {
    renderBoard()
    await screen.findByText('Setup project')
    fireEvent.click(screen.getByLabelText('More actions'))
    expect(screen.queryByText('Delete board')).toBeNull()
  })

  it('active sprint cards are not draggable', () => {
    renderActiveSprint()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')
    expect(card.getAttribute('draggable')).toBe('false')
  })

  it('hides the Complete sprint button', () => {
    renderActiveSprint()
    expect(screen.queryByText('Complete sprint')).toBeNull()
  })
})

describe('JL-285 — Member sees edit controls but no admin actions', () => {
  beforeEach(() => { mockPerms = { ...MEMBER_PERMS } })

  it('board cards are draggable with a per-card status select', async () => {
    renderBoard()
    await screen.findByText('Setup project')
    const card = screen.getByText('Setup project').closest('.card')
    expect(card.getAttribute('draggable')).toBe('true')
    expect(card.querySelector('select')).toBeTruthy()
    expect(card.querySelector('.kanban-status-readonly')).toBeNull()
  })

  it('still hides the Delete board menu item (no canManageProjectSettings)', async () => {
    renderBoard()
    await screen.findByText('Setup project')
    fireEvent.click(screen.getByLabelText('More actions'))
    expect(screen.queryByText('Delete board')).toBeNull()
  })

  it('active sprint cards are draggable', () => {
    renderActiveSprint()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')
    expect(card.getAttribute('draggable')).toBe('true')
  })

  it('still hides the Complete sprint button (no canManageSprints)', () => {
    renderActiveSprint()
    expect(screen.queryByText('Complete sprint')).toBeNull()
  })
})

describe('JL-285 — Admin/Lead has full board and sprint control', () => {
  beforeEach(() => { mockPerms = { ...ADMIN_PERMS } })

  it('board cards draggable, status select present, Delete board available', async () => {
    renderBoard()
    await screen.findByText('Setup project')
    const card = screen.getByText('Setup project').closest('.card')
    expect(card.getAttribute('draggable')).toBe('true')
    expect(card.querySelector('select')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('More actions'))
    expect(screen.getByText('Delete board')).toBeInTheDocument()
  })

  it('active sprint cards draggable and Complete sprint button present', () => {
    renderActiveSprint()
    const card = screen.getByText('Setup project').closest('.active-sprint-card')
    expect(card.getAttribute('draggable')).toBe('true')
    expect(screen.getByText('Complete sprint')).toBeInTheDocument()
  })
})
