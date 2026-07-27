// JL-288 — RBAC: project Viewers may export issue data (a READ operation) even
// though Import stays Member+. The Backlog toolbar splits the old combined
// "Import / Export" control into separate Export (canExportIssues, incl. Viewers)
// and Import (canCreateIssue) buttons, and the ImportExportModal hides its Import
// tab/section when canImport is false.
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

vi.mock('../api/importExportApi', () => ({
  downloadProjectExport: vi.fn().mockResolvedValue(undefined),
  importIssues: vi.fn().mockResolvedValue({ dryRun: true, valid: 0, invalid: 0, totalRows: 0, errors: [] }),
}))

// ── Context mocks ──
const mockIssues = [
  { id: 1, key: 'TP-1', title: 'Backlog story', status: 'Backlog', priority: 'Medium', issueType: 'Story', assignee: 'Alice', sprintId: null, projectId: 1 },
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
    currentMember: { workspaceRole: 'Viewer', isOwner: false, projectRoles: [] },
  }),
}))

import { BacklogPage } from '../pages/BacklogPage/BacklogPage'
import { ImportExportModal } from '../components/issues/ImportExportModal'

const VIEWER_PERMS = {
  loaded: true,
  canCreateIssue: false,
  canEditIssue: false,
  canDeleteIssue: false,
  canManageSprints: false,
  canExportIssues: true,
}

const MEMBER_PERMS = {
  loaded: true,
  canCreateIssue: true,
  canEditIssue: true,
  canDeleteIssue: false,
  canManageSprints: false,
  canExportIssues: true,
}

function renderBacklog() {
  return render(
    <MemoryRouter>
      <BacklogPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Backlog toolbar gating ──

describe('JL-288 — Backlog toolbar: Export vs Import gating', () => {
  it('Viewer sees Export but not Import', () => {
    mockPerms = { ...VIEWER_PERMS }
    renderBacklog()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  })

  it('Member sees both Export and Import', () => {
    mockPerms = { ...MEMBER_PERMS }
    renderBacklog()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()
  })

  it('Viewer opening the modal from Export sees only the Export tab (no Import tab/section)', () => {
    mockPerms = { ...VIEWER_PERMS }
    renderBacklog()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    // Modal open with Export controls
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeInTheDocument()
    // No Import tab
    expect(screen.getByRole('heading', { name: 'Export issues' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  })

  it('Member opening the modal from Import lands on the Import tab', () => {
    mockPerms = { ...MEMBER_PERMS }
    renderBacklog()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    // Import textarea placeholder present -> import section rendered
    expect(screen.getByRole('heading', { name: 'Import / Export issues' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preview \(dry run\)/ })).toBeInTheDocument()
  })
})

// ── Modal-level gating ──

describe('JL-288 — ImportExportModal canImport gating', () => {
  it('hides the Import tab/section when canImport=false', () => {
    render(<ImportExportModal projectId={1} canImport={false} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
    // Import tab button absent; only the Export tab remains
    const tabs = screen.getAllByRole('button', { name: 'Export' })
    expect(tabs.length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Preview \(dry run\)/ })).toBeNull()
  })

  it('shows both tabs when canImport=true', () => {
    render(<ImportExportModal projectId={1} canImport onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(screen.getByRole('button', { name: /Preview \(dry run\)/ })).toBeInTheDocument()
  })
})
