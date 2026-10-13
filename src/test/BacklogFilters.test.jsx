// Backlog Filter menu + avatar quick filters. The toolbar "Filter" button and
// member avatars used to render with no handler at all.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  EMPTY_FILTERS, UNASSIGNED, buildFilterOptions, countActiveFilters, matchesFilters, toggleFilterValue,
} from '../utils/backlogFilters'

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ loaded: true, canCreateIssue: true, canEditIssue: true, canDeleteIssue: false, canManageSprints: false }),
}))
vi.mock('../api/dependencyApi', () => ({
  fetchProjectDependencies: vi.fn().mockResolvedValue({ issues: [], edges: [], cycles: [], summary: {} }),
}))
vi.mock('../api/watcherApi', () => ({
  fetchWatchers: vi.fn().mockResolvedValue([]),
  watchIssue: vi.fn().mockResolvedValue({ watching: true }),
  unwatchIssue: vi.fn().mockResolvedValue({ watching: false }),
}))

let mockIssues = []
let mockMembers = []

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: mockIssues, handleMove: vi.fn(), handleUpdate: vi.fn(), handleDelete: vi.fn(), handleCreate: vi.fn(), reloadIssues: vi.fn(),
  }),
}))
vi.mock('../context/SprintContext', () => {
  const sprints = [{ id: 10, name: 'Sprint 1', dateRange: 'Jul 1 - Jul 14', isStarted: false }]
  return {
    useSprints: () => ({
      sprints, handleCreateSprint: vi.fn(), handleStartSprint: vi.fn(), handleUpdateSprint: vi.fn(), handleDeleteSprint: vi.fn(),
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
    id: 0, key: 'TP-0', title: 'Issue', status: 'Backlog', priority: 'Medium', issueType: 'Task', assignee: '',
    sprintId: null, projectId: 1, storyPoints: null, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z',
    ...overrides,
  }
}

const ISSUES = [
  issue({ id: 1, key: 'TP-1', title: 'Login bug', issueType: 'Bug', priority: 'High', assignee: 'Alice Anderson' }),
  issue({ id: 2, key: 'TP-2', title: 'Profile story', issueType: 'Story', priority: 'Low', assignee: 'bob@example.com' }),
  issue({ id: 3, key: 'TP-3', title: 'Orphan task', issueType: 'Task', priority: 'Medium', assignee: '' }),
  issue({ id: 4, key: 'TP-4', title: 'Sprint bug', issueType: 'Bug', priority: 'Low', status: 'In Progress', sprintId: 10, assignee: 'Bob Brown' }),
]

describe('backlogFilters helpers', () => {
  it('matches everything when no filter is set', () => {
    expect(ISSUES.every((i) => matchesFilters(i, EMPTY_FILTERS))).toBe(true)
  })

  it('ORs values within a field and ANDs across fields', () => {
    const filters = { ...EMPTY_FILTERS, issueType: ['Bug', 'Story'], priority: ['Low'] }
    expect(ISSUES.filter((i) => matchesFilters(i, filters)).map((i) => i.id)).toEqual([2, 4])
  })

  it('matches unassigned issues via the UNASSIGNED sentinel', () => {
    const filters = { ...EMPTY_FILTERS, assignee: [UNASSIGNED] }
    expect(ISSUES.filter((i) => matchesFilters(i, filters)).map((i) => i.id)).toEqual([3])
  })

  it('builds options only from present values, in canonical order', () => {
    const options = buildFilterOptions(ISSUES)
    expect(options.priority).toEqual(['Low', 'Medium', 'High'])
    expect(options.issueType).toEqual(['Story', 'Bug', 'Task'])
    expect(options.assignee[0]).toBe(UNASSIGNED)
    expect(options.status).toEqual(['Backlog', 'In Progress'])
  })

  it('returns empty options for an empty issue list', () => {
    const options = buildFilterOptions([])
    expect(Object.values(options).every((list) => list.length === 0)).toBe(true)
  })

  it('toggles values on and off without mutating the input', () => {
    const on = toggleFilterValue(EMPTY_FILTERS, 'priority', 'High')
    expect(on.priority).toEqual(['High'])
    expect(EMPTY_FILTERS.priority).toEqual([])
    expect(toggleFilterValue(on, 'priority', 'High').priority).toEqual([])
    expect(countActiveFilters({ ...on, status: ['Backlog'] })).toBe(2)
  })
})

describe('BacklogPage filters', () => {
  beforeEach(() => {
    mockIssues = ISSUES
    mockMembers = [
      { id: 1, name: 'Alice Anderson', email: 'alice@example.com' },
      { id: 2, name: 'Bob Brown', email: 'bob@example.com' },
    ]
  })

  function renderBacklog() {
    render(<MemoryRouter><BacklogPage /></MemoryRouter>)
    // Sprint panels start collapsed; expand so sprint issues are visible too.
    fireEvent.click(screen.getByRole('button', { name: 'Expand Sprint 1' }))
  }

  function openFilterMenu() {
    fireEvent.click(screen.getByRole('button', { name: /filter$/i }))
    return screen.getByRole('dialog', { name: 'Filter backlog' })
  }

  it('the Filter button opens a menu of field filters', () => {
    renderBacklog()
    const menu = openFilterMenu()
    for (const legend of ['Type', 'Priority', 'Status', 'Assignee']) {
      expect(within(menu).getByText(legend)).toBeInTheDocument()
    }
    expect(within(menu).getByRole('checkbox', { name: 'Unassigned' })).toBeInTheDocument()
  })

  it('checking a type hides other types in backlog and sprint panels', () => {
    renderBacklog()
    const menu = openFilterMenu()
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Bug' }))
    expect(screen.getByText('Login bug')).toBeInTheDocument()
    expect(screen.getByText('Sprint bug')).toBeInTheDocument()
    expect(screen.queryByText('Profile story')).not.toBeInTheDocument()
    expect(screen.queryByText('Orphan task')).not.toBeInTheDocument()
  })

  it('Clear filters restores every issue and is disabled when nothing is set', () => {
    renderBacklog()
    const menu = openFilterMenu()
    const clear = within(menu).getByRole('button', { name: 'Clear filters' })
    expect(clear).toBeDisabled()
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'High' }))
    expect(screen.queryByText('Orphan task')).not.toBeInTheDocument()
    fireEvent.click(clear)
    expect(screen.getByText('Orphan task')).toBeInTheDocument()
    expect(clear).toBeDisabled()
  })

  it('a member avatar toggles an assignee filter covering name and email', () => {
    renderBacklog()
    const bob = screen.getByRole('button', { name: 'Filter by assignee Bob Brown' })
    expect(bob).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(bob)
    expect(bob).toHaveAttribute('aria-pressed', 'true')
    // assigned by email and by name — both are Bob's
    expect(screen.getByText('Profile story')).toBeInTheDocument()
    expect(screen.getByText('Sprint bug')).toBeInTheDocument()
    expect(screen.queryByText('Login bug')).not.toBeInTheDocument()
    fireEvent.click(bob)
    expect(bob).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Login bug')).toBeInTheDocument()
  })

  it('filters combine with "My open issues"', () => {
    renderBacklog()
    fireEvent.click(screen.getByText('My open issues'))
    const menu = openFilterMenu()
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Story' }))
    // Alice owns only a Bug, so Story ∧ mine is empty
    expect(screen.queryByText('Login bug')).not.toBeInTheDocument()
    expect(screen.queryByText('Profile story')).not.toBeInTheDocument()
  })
})
