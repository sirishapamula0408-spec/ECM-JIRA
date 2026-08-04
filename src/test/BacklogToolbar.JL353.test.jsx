// JL-353 — Backlog toolbar real data:
//  1. The dead "Views" / "Display settings" / "More" icon buttons (which
//     rendered literal "chart"/"settings"/"..." text and did nothing) are gone.
//  2. Toolbar avatars show real member initials (capped at 4, title = name)
//     instead of four hardcoded fake chips; zero members renders no chips.
//  3. The per-panel metric pills show live To Do / In Progress / Done
//     status-*category* counts instead of hardcoded "0"s. Categories mirror
//     the server's issue_statuses.category seeds: Backlog+To Do -> todo;
//     In Progress/Code Review/In Testing/In Rework/In UAT -> inprogress;
//     Done+Cancelled -> done.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

// ── Context mocks (mutable per test) ──
let mockIssues = []
let mockMembers = []

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
    profile: { full_name: 'Alice Anderson' },
    members: mockMembers,
    currentMember: { workspaceRole: 'Member', isOwner: false, projectRoles: [] },
  }),
}))

import { BacklogPage } from '../pages/BacklogPage/BacklogPage'

function issue(overrides) {
  return {
    id: 0, key: 'TP-0', title: 'Issue', status: 'Backlog', priority: 'Medium',
    issueType: 'Task', assignee: '', sprintId: null, projectId: 1,
    storyPoints: null, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z',
    ...overrides,
  }
}

function renderBacklog() {
  return render(
    <MemoryRouter>
      <BacklogPage />
    </MemoryRouter>,
  )
}

function pillTexts(rowSelector) {
  return Array.from(document.querySelectorAll(`${rowSelector} .metric-pill`)).map((el) => el.textContent)
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mockIssues = []
  mockMembers = [
    { id: 1, name: 'Alice Anderson', email: 'alice@test.com' },
    { id: 2, name: 'Bob Brown', email: 'bob@test.com' },
  ]
})

describe('JL-353 — Backlog toolbar real data', () => {
  it('does not render the dead Views / Display settings / More buttons', () => {
    renderBacklog()
    expect(screen.queryByRole('button', { name: 'Views' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Display settings' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
    // The literal placeholder words must not appear as button text either.
    expect(screen.queryByText('chart')).toBeNull()
    expect(screen.queryByText('settings')).toBeNull()
  })

  it('renders sprint pills with live counts: 2 To Do + 1 Done shows "2" and "1", not "0"', () => {
    mockIssues = [
      issue({ id: 1, key: 'TP-1', status: 'To Do', sprintId: 10 }),
      issue({ id: 2, key: 'TP-2', status: 'To Do', sprintId: 10 }),
      issue({ id: 3, key: 'TP-3', status: 'Done', sprintId: 10 }),
    ]
    renderBacklog()
    expect(pillTexts('.jira-sprint-row')).toEqual(['2', '0', '1'])
  })

  it('buckets non-pill statuses by category instead of dropping them (Code Review + QA Lifecycle -> in-progress)', () => {
    mockIssues = [
      issue({ id: 1, key: 'TP-1', status: 'To Do', sprintId: 10 }),
      issue({ id: 2, key: 'TP-2', status: 'Code Review', sprintId: 10 }),
      issue({ id: 3, key: 'TP-3', status: 'In Testing', sprintId: 10 }),
      issue({ id: 4, key: 'TP-4', status: 'In UAT', sprintId: 10 }),
      issue({ id: 5, key: 'TP-5', status: 'Cancelled', sprintId: 10 }),
      issue({ id: 6, key: 'TP-6', status: 'Done', sprintId: 10 }),
    ]
    renderBacklog()
    // 1 todo, 3 inprogress (Code Review + In Testing + In UAT), 2 done (Done + Cancelled)
    expect(pillTexts('.jira-sprint-row')).toEqual(['1', '3', '2'])
  })

  it('computes backlog-panel pills from backlogItems (all Backlog status -> todo bucket)', () => {
    mockIssues = [
      issue({ id: 1, key: 'TP-1', status: 'Backlog' }),
      issue({ id: 2, key: 'TP-2', status: 'Backlog' }),
      issue({ id: 3, key: 'TP-3', status: 'Backlog' }),
      // Sprint issue must not leak into the backlog panel's counts.
      issue({ id: 4, key: 'TP-4', status: 'Done', sprintId: 10 }),
    ]
    renderBacklog()
    expect(pillTexts('.jira-backlog-row')).toEqual(['3', '0', '0'])
    expect(pillTexts('.jira-sprint-row')).toEqual(['0', '0', '1'])
  })

  it('shows real member initials with the member name as title, capped at four', () => {
    mockMembers = [
      { id: 1, name: 'Alice Anderson', email: 'a@test.com' },
      { id: 2, name: 'Bob Brown', email: 'b@test.com' },
      { id: 3, name: 'Carol Chen', email: 'c@test.com' },
      { id: 4, name: 'Dan Diaz', email: 'd@test.com' },
      { id: 5, name: 'Eve Evans', email: 'e@test.com' },
      { id: 6, name: 'Frank Field', email: 'f@test.com' },
    ]
    renderBacklog()
    const chips = Array.from(document.querySelectorAll('.backlog-avatars .assignee-chip'))
    expect(chips.map((el) => el.textContent)).toEqual(['AA', 'BB', 'CC', 'DD'])
    expect(chips.map((el) => el.getAttribute('title'))).toEqual(['Alice Anderson', 'Bob Brown', 'Carol Chen', 'Dan Diaz'])
  })

  it('renders fewer chips for fewer members and none of them empty', () => {
    mockMembers = [{ id: 1, name: 'Alice Anderson', email: 'a@test.com' }]
    renderBacklog()
    const chips = Array.from(document.querySelectorAll('.assignee-chip'))
    expect(chips).toHaveLength(1)
    expect(chips[0].textContent).toBe('AA')
  })

  it('renders no avatar chips (and no empty container) when there are zero members', () => {
    mockMembers = []
    renderBacklog()
    expect(document.querySelectorAll('.assignee-chip')).toHaveLength(0)
    expect(document.querySelector('.backlog-avatars')).toBeNull()
  })
})
