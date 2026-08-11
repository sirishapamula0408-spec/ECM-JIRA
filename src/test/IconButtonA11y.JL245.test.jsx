// JL-245 — A11y: every icon-only button on Backlog and Board must expose a
// discernible accessible name (WCAG 4.1.2). jest-axe/axe-core is not available
// in this repo, so this suite renders both pages with full (admin) permissions,
// opens the menus/panels that contain icon-only controls, and asserts that each
// <button> has a non-empty accessible name (aria-label, aria-labelledby, or
// visible text content that is not aria-hidden).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// ── Permission mock (admin-ish: max controls rendered on both pages) ──
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    loaded: true,
    isAdmin: true,
    canCreateIssue: true,
    canEditIssue: true,
    canDeleteIssue: true,
    canManageSprints: true,
    canManageProjectSettings: true,
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

const mockFetchBoardConfig = vi.fn()
vi.mock('../api/boardConfigApi', () => ({
  fetchBoardConfig: (...args) => mockFetchBoardConfig(...args),
  saveBoardConfig: vi.fn().mockResolvedValue({}),
  ESTIMATION_STATISTIC_OPTIONS: [
    { value: 'story_points', label: 'Story Points' },
    { value: 'time_estimate', label: 'Original Time Estimate' },
    { value: 'issue_count', label: 'Issue Count' },
  ],
}))

// ── Context mocks ──
const mockIssues = [
  { id: 1, key: 'TP-1', title: 'Backlog story', status: 'Backlog', priority: 'Medium', issueType: 'Story', assignee: 'Alice', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Sprint task', status: 'To Do', priority: 'High', issueType: 'Task', assignee: 'Bob', sprintId: 10, projectId: 1 },
  { id: 3, key: 'TP-3', title: 'Board bug', status: 'In Progress', priority: 'Low', issueType: 'Bug', assignee: 'Alice', projectId: 1 },
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
    currentMember: { workspaceRole: 'Admin', isOwner: false, projectRoles: [] },
  }),
}))

import { BacklogPage } from '../pages/BacklogPage/BacklogPage'
import { BoardPage } from '../pages/BoardPage/BoardPage'

/**
 * Approximation of the WCAG accessible-name computation for a button:
 * aria-label → aria-labelledby → visible text content (aria-hidden subtrees
 * excluded) → title attribute (last-resort per accname spec).
 */
function accessibleName(btn) {
  const ariaLabel = btn.getAttribute('aria-label')
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim()

  const labelledBy = btn.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '')
      .join(' ')
      .trim()
    if (text) return text
  }

  // Visible text content, excluding aria-hidden subtrees
  const clone = btn.cloneNode(true)
  clone.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove())
  const text = (clone.textContent || '').trim()
  if (text) return text

  const title = btn.getAttribute('title')
  if (title && title.trim()) return title.trim()

  return ''
}

function assertAllButtonsNamed(context) {
  const buttons = Array.from(document.querySelectorAll('button'))
  expect(buttons.length).toBeGreaterThan(0)
  const unnamed = buttons.filter((b) => accessibleName(b) === '')
  const describe = (b) => `<button class="${b.className}">${(b.innerHTML || '').slice(0, 60)}</button>`
  expect(
    unnamed.map(describe),
    `${context}: ${unnamed.length} button(s) missing an accessible name`,
  ).toEqual([])
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchBoardConfig.mockResolvedValue({ projectId: 1, swimlaneBy: 'none', wipLimits: {}, quickFilters: [] })
})

describe('JL-245 — Backlog: no icon-only button lacks an accessible name', () => {
  it('all buttons on the default Backlog view have accessible names', () => {
    render(
      <MemoryRouter>
        <BacklogPage />
      </MemoryRouter>,
    )
    assertAllButtonsNamed('Backlog (default)')
    cleanup()
  })

  it('all buttons remain named with sprint panel expanded and sprint menu open', () => {
    render(
      <MemoryRouter>
        <BacklogPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Expand Sprint 1' }))
    fireEvent.click(screen.getByLabelText('Sprint actions'))
    assertAllButtonsNamed('Backlog (expanded + sprint menu)')
    cleanup()
  })

  // JL-383: this test named the three icon-only toolbar buttons that existed when
  // JL-245 was written — "Views", "Display settings" and "More". JL-353 deleted
  // all three from BacklogPage: they rendered literal placeholder glyph text
  // ("chart", "settings", "...") and had no onClick or defined behavior, so they
  // were dead UI, and the removal is documented in BacklogPage.jsx. The test was
  // never re-pointed, so it asserted the presence of deliberately-removed
  // controls — the exact opposite of BacklogToolbar.JL353.test.jsx's "does not
  // render the dead Views / Display settings / More buttons". Re-point it at the
  // icon-only buttons the Backlog actually renders today; the aria-label
  // requirement being tested is unchanged.
  it('icon-only glyph buttons expose aria-labels', () => {
    render(
      <MemoryRouter>
        <BacklogPage />
      </MemoryRouter>,
    )
    // Toolbar: sort-direction toggle (arrow icon only).
    expect(screen.getByLabelText('Sort direction: ascending')).toBeInTheDocument()
    // Sprint panel header: caret toggle (aria-hidden span only) and "..." menu.
    expect(screen.getByLabelText('Expand Sprint 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Sprint actions')).toBeInTheDocument()
    // Backlog panel header: its own caret toggle.
    expect(screen.getByLabelText(/^(Expand|Collapse) backlog$/)).toBeInTheDocument()
    cleanup()
  })
})

describe('JL-245 — Board: no icon-only button lacks an accessible name', () => {
  function renderBoard() {
    return render(
      <MemoryRouter initialEntries={['/projects/1/board']}>
        <Routes>
          <Route path="/projects/:projectId/board" element={<BoardPage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('all buttons on the default Board view have accessible names', async () => {
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())
    assertAllButtonsNamed('Board (default)')
    cleanup()
  })

  it('all buttons remain named with board menu and settings panel open', async () => {
    renderBoard()
    await waitFor(() => expect(mockFetchBoardConfig).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('More actions'))
    assertAllButtonsNamed('Board (board menu open)')
    fireEvent.click(screen.getByText('Board settings', { selector: '.board-settings-toggle' }))
    assertAllButtonsNamed('Board (settings panel open)')
    cleanup()
  })
})
