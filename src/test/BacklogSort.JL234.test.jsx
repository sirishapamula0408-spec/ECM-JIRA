// JL-234 — Backlog sort control: client-side sort by priority / key / assignee /
// created / updated / story points with an asc/desc toggle, persisted in
// localStorage and restored on mount. Default ordering is unchanged when no
// preference is stored.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Permission mock ──
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    loaded: true,
    canCreateIssue: true,
    canEditIssue: true,
    canDeleteIssue: false,
    canManageSprints: false,
  }),
}))

// ── API mocks ──
vi.mock('../api/dependencyApi', () => ({
  fetchProjectDependencies: vi.fn().mockResolvedValue({ issues: [], edges: [], cycles: [], summary: {} }),
}))

vi.mock('../api/watcherApi', () => ({
  fetchWatchers: vi.fn().mockResolvedValue([]),
  watchIssue: vi.fn().mockResolvedValue({ watching: true }),
  unwatchIssue: vi.fn().mockResolvedValue({ watching: false }),
}))

// ── Context mocks ──
// Default (as-provided) order: TP-2, TP-10, TP-1. All in the Backlog panel,
// which is expanded by default.
const mockIssues = [
  { id: 1, key: 'TP-2', title: 'Bravo', status: 'Backlog', priority: 'High', issueType: 'Story', assignee: 'Bob', sprintId: null, projectId: 1, storyPoints: 5, createdAt: '2026-01-02T10:00:00Z', updatedAt: '2026-01-05T10:00:00Z' },
  { id: 2, key: 'TP-10', title: 'Alpha', status: 'Backlog', priority: 'Low', issueType: 'Task', assignee: '', sprintId: null, projectId: 1, storyPoints: null, createdAt: '2026-01-03T10:00:00Z', updatedAt: null },
  { id: 3, key: 'TP-1', title: 'Charlie', status: 'Backlog', priority: 'Medium', issueType: 'Bug', assignee: 'Alice', sprintId: null, projectId: 1, storyPoints: 2, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-06T10:00:00Z' },
]

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: mockIssues,
    handleMove: vi.fn(),
    handleUpdate: vi.fn(),
    handleDelete: vi.fn(),
    handleCreate: vi.fn(),
    reloadIssues: vi.fn(),
  }),
}))

vi.mock('../context/SprintContext', () => {
  // Stable reference — BacklogPage's useEffect(..., [sprints]) would loop on a fresh array.
  const sprints = [{ id: 10, name: 'Sprint 1', dateRange: 'Jul 1 - Jul 14', isStarted: false }]
  return {
    useSprints: () => ({
      sprints,
      handleCreateSprint: vi.fn(),
      handleStartSprint: vi.fn(),
      handleUpdateSprint: vi.fn(),
      handleDeleteSprint: vi.fn(),
    }),
  }
})

vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    profile: { full_name: 'Alice' },
    members: [{ id: 1, name: 'Alice', email: 'alice@test.com' }],
    currentMember: { workspaceRole: 'Member', isOwner: false, projectRoles: [] },
  }),
}))

import { BacklogPage } from '../pages/BacklogPage/BacklogPage'

function renderBacklog() {
  return render(
    <MemoryRouter>
      <BacklogPage />
    </MemoryRouter>,
  )
}

function rowKeys() {
  return Array.from(document.querySelectorAll('.backlog-issue-row .backlog-issue-main small')).map((el) => el.textContent)
}

function selectSort(field) {
  fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: field } })
}

function toggleDirection() {
  fireEvent.click(screen.getByRole('button', { name: /Sort direction/ }))
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('JL-234 — Backlog sort control', () => {
  it('keeps the default ordering when no preference is stored', () => {
    renderBacklog()
    expect(screen.getByLabelText('Sort by')).toHaveValue('')
    expect(rowKeys()).toEqual(['TP-2', 'TP-10', 'TP-1'])
  })

  it('sorts by priority ascending, then descending via the direction toggle', () => {
    renderBacklog()
    selectSort('priority')
    expect(rowKeys()).toEqual(['TP-10', 'TP-1', 'TP-2']) // Low → Medium → High
    toggleDirection()
    expect(rowKeys()).toEqual(['TP-2', 'TP-1', 'TP-10']) // High → Medium → Low
  })

  it('sorts by key with numeric awareness (TP-10 after TP-2)', () => {
    renderBacklog()
    selectSort('key')
    expect(rowKeys()).toEqual(['TP-1', 'TP-2', 'TP-10'])
  })

  it('sorts by assignee and keeps unassigned issues last in both directions', () => {
    renderBacklog()
    selectSort('assignee')
    expect(rowKeys()).toEqual(['TP-1', 'TP-2', 'TP-10']) // Alice, Bob, unassigned last
    toggleDirection()
    expect(rowKeys()).toEqual(['TP-2', 'TP-1', 'TP-10']) // Bob, Alice, unassigned still last
  })

  it('sorts by created and updated dates (missing updated sorts last)', () => {
    renderBacklog()
    selectSort('created')
    expect(rowKeys()).toEqual(['TP-1', 'TP-2', 'TP-10'])
    selectSort('updated')
    expect(rowKeys()).toEqual(['TP-2', 'TP-1', 'TP-10']) // TP-10 has no updatedAt
  })

  it('sorts by story points and keeps unestimated issues last in both directions', () => {
    renderBacklog()
    selectSort('storyPoints')
    expect(rowKeys()).toEqual(['TP-1', 'TP-2', 'TP-10']) // 2, 5, none last
    toggleDirection()
    expect(rowKeys()).toEqual(['TP-2', 'TP-1', 'TP-10']) // 5, 2, none still last
  })

  it('persists the chosen sort field and direction to localStorage', () => {
    renderBacklog()
    selectSort('priority')
    expect(JSON.parse(window.localStorage.getItem('backlogSort'))).toEqual({ field: 'priority', direction: 'asc' })
    toggleDirection()
    expect(JSON.parse(window.localStorage.getItem('backlogSort'))).toEqual({ field: 'priority', direction: 'desc' })
  })

  it('restores the stored sort preference on mount', () => {
    window.localStorage.setItem('backlogSort', JSON.stringify({ field: 'storyPoints', direction: 'desc' }))
    renderBacklog()
    expect(screen.getByLabelText('Sort by')).toHaveValue('storyPoints')
    expect(rowKeys()).toEqual(['TP-2', 'TP-1', 'TP-10'])
  })

  it('ignores an invalid stored preference and falls back to the default order', () => {
    window.localStorage.setItem('backlogSort', '{not json')
    renderBacklog()
    expect(screen.getByLabelText('Sort by')).toHaveValue('')
    expect(rowKeys()).toEqual(['TP-2', 'TP-10', 'TP-1'])
  })

  it('disables the direction toggle while default ordering is active', () => {
    renderBacklog()
    expect(screen.getByRole('button', { name: /Sort direction/ })).toBeDisabled()
    selectSort('key')
    expect(screen.getByRole('button', { name: /Sort direction/ })).toBeEnabled()
  })
})
