// JL-230 — RBAC: Viewer read-only Backlog. Mutating controls (create forms,
// bulk toolbar, bulk delete, sprint management, drag/status affordances) are
// gated behind usePermissions; Viewers keep full read access.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Permission mock (mutated per test) ──
let mockPerms = {}
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => mockPerms,
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
const mockIssues = [
  { id: 1, key: 'TP-1', title: 'Backlog story', status: 'Backlog', priority: 'Medium', issueType: 'Story', assignee: 'Alice', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Sprint task', status: 'To Do', priority: 'High', issueType: 'Task', assignee: 'Bob', sprintId: 10, projectId: 1 },
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

const VIEWER_PERMS = {
  loaded: true,
  canCreateIssue: false,
  canEditIssue: false,
  canDeleteIssue: false,
  canManageSprints: false,
}

const MEMBER_PERMS = {
  loaded: true,
  canCreateIssue: true,
  canEditIssue: true,
  canDeleteIssue: false,
  canManageSprints: false,
}

const ADMIN_PERMS = {
  loaded: true,
  canCreateIssue: true,
  canEditIssue: true,
  canDeleteIssue: true,
  canManageSprints: true,
}

function renderBacklog() {
  return render(
    <MemoryRouter>
      <BacklogPage />
    </MemoryRouter>,
  )
}

function expandSprintPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Expand Sprint 1' }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Viewer: read-only backlog ──

describe('JL-230 — Viewer sees a read-only Backlog', () => {
  beforeEach(() => { mockPerms = { ...VIEWER_PERMS } })

  it('still shows backlog and sprint contents (read access intact)', () => {
    renderBacklog()
    expect(screen.getByText('Backlog story')).toBeInTheDocument()
    expect(screen.getByText('TP-1')).toBeInTheDocument()
    expandSprintPanel()
    expect(screen.getByText('Sprint task')).toBeInTheDocument()
    // Search / quick filter (read-only tools) remain available
    expect(screen.getByPlaceholderText('Search backlog...')).toBeInTheDocument()
    expect(screen.getByText('My open issues')).toBeInTheDocument()
  })

  it('hides the bulk-action toolbar and Import / Export', () => {
    renderBacklog()
    expect(screen.queryByLabelText('Bulk action')).toBeNull()
    expect(screen.queryByText('Apply')).toBeNull()
    expect(screen.queryByText('Advanced bulk change')).toBeNull()
    expect(screen.queryByText(/selected/)).toBeNull()
    expect(screen.queryByText('Import / Export')).toBeNull()
  })

  it('hides selection checkboxes on sections and rows', () => {
    renderBacklog()
    expandSprintPanel()
    expect(screen.queryByLabelText('Select all backlog issues')).toBeNull()
    expect(screen.queryByLabelText('Select all Sprint 1 issues')).toBeNull()
    expect(screen.queryByLabelText('Select TP-1')).toBeNull()
    expect(screen.queryByLabelText('Select TP-2')).toBeNull()
  })

  it('hides sprint management controls (create / start / menu)', () => {
    renderBacklog()
    expect(screen.queryByText('Create sprint')).toBeNull()
    expect(screen.queryByText('Start sprint')).toBeNull()
    expect(screen.queryByLabelText('Sprint actions')).toBeNull()
  })

  it('hides the inline issue-create affordance in sprint panels', () => {
    renderBacklog()
    expandSprintPanel()
    expect(document.querySelector('.sprint-inline-create')).toBeNull()
    expect(document.querySelector('.quick-create-row')).toBeNull()
  })

  it('renders rows without edit affordances: no status select, no flag button, not draggable', () => {
    renderBacklog()
    const row = screen.getByText('Backlog story').closest('.backlog-issue-row')
    expect(row.getAttribute('draggable')).toBe('false')
    expect(document.querySelector('.backlog-status-select')).toBeNull()
    expect(document.querySelector('.flag-btn')).toBeNull()
    // Status is still readable as a static chip
    expect(row.querySelector('.backlog-status-readonly')).toHaveTextContent('BACKLOG')
  })
})

// ── Member: mutate controls visible, but no delete / sprint management ──

describe('JL-230 — Member sees create/edit controls', () => {
  beforeEach(() => { mockPerms = { ...MEMBER_PERMS } })

  it('shows the bulk toolbar without the Delete option', () => {
    renderBacklog()
    const picker = screen.getByLabelText('Bulk action')
    expect(picker).toBeInTheDocument()
    expect(screen.getByText('Apply')).toBeInTheDocument()
    const options = Array.from(picker.querySelectorAll('option')).map((o) => o.value)
    expect(options).toContain('status')
    expect(options).toContain('watch')
    expect(options).not.toContain('delete')
  })

  it('shows Import / Export, row checkboxes, status selects and inline create', () => {
    renderBacklog()
    expandSprintPanel()
    expect(screen.getByText('Import / Export')).toBeInTheDocument()
    expect(screen.getByLabelText('Select TP-1')).toBeInTheDocument()
    expect(screen.getByLabelText('Status for TP-1')).toBeInTheDocument()
    expect(document.querySelector('.sprint-inline-create')).toBeTruthy()
    const row = screen.getByText('Backlog story').closest('.backlog-issue-row')
    expect(row.getAttribute('draggable')).toBe('true')
  })

  it('opens the quick-create form from the inline Create button', () => {
    renderBacklog()
    expandSprintPanel()
    fireEvent.click(document.querySelector('.sprint-inline-create'))
    expect(screen.getByPlaceholderText('What needs to be done?')).toBeInTheDocument()
  })

  it('still hides sprint management controls without canManageSprints', () => {
    renderBacklog()
    expect(screen.queryByText('Create sprint')).toBeNull()
    expect(screen.queryByText('Start sprint')).toBeNull()
    expect(screen.queryByLabelText('Sprint actions')).toBeNull()
  })
})

// ── Admin: everything visible ──

describe('JL-230 — Admin sees delete and sprint management controls', () => {
  beforeEach(() => { mockPerms = { ...ADMIN_PERMS } })

  it('shows the Delete bulk option', () => {
    renderBacklog()
    const picker = screen.getByLabelText('Bulk action')
    const options = Array.from(picker.querySelectorAll('option')).map((o) => o.value)
    expect(options).toContain('delete')
  })

  it('shows sprint create / start / actions menu', () => {
    renderBacklog()
    expect(screen.getByText('Create sprint')).toBeInTheDocument()
    expect(screen.getByText('Start sprint')).toBeInTheDocument()
    expect(screen.getByLabelText('Sprint actions')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Sprint actions'))
    expect(screen.getByText('Rename sprint')).toBeInTheDocument()
    expect(screen.getByText('Delete sprint')).toBeInTheDocument()
  })
})
