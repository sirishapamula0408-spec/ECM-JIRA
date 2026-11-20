// JL-486: app-wide dark-mode polish and the small Backlog/sidebar items found
// while verifying JL-485. jsdom does not apply stylesheets, so the CSS items
// are guarded by reading the stylesheets; the browser check measured them.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const css = (path) => readFileSync(resolve(__dirname, path), 'utf8')
const theme = css('../styles/theme.css')

describe('dark-mode rules', () => {
  it('lets native controls (checkboxes, selects) render dark', () => {
    expect(theme).toMatch(/\.app-theme-dark\s*\{[^}]*color-scheme:\s*dark/)
  })

  for (const selector of [
    '.backlog-search-input', '.bulk-status-select', // 1. white form controls
    '.backlog-top-item', '.backlog-top-item.active', // 2. project tabs
    '.project-top-panel-wrapper', '.project-breadcrumb-current', // 3. breadcrumb strip
    '.topbar-brand-name', '.topbar-clock-time', // 4. top bar
    '.spaces-menu', '.spaces-menu-item', // 6. sidebar Projects "…" menu
  ]) {
    it(`has a dark rule for ${selector}`, () => {
      expect(theme).toContain(`.app-theme-dark ${selector}`)
    })
  }
})

describe('layout fixes (both themes)', () => {
  it('7. the sidebar Projects section can shrink below its longest name, so the sidebar never scrolls sideways', () => {
    expect(css('../components/layout/Sidebar.css')).toMatch(/\.sidebar-projects-section\s*\{[^}]*min-width:\s*0/)
  })

  it('7. the Projects "…" menu is narrow enough to open inside the sidebar', () => {
    // At 220px it ran off the window's left edge once the button sat inside the sidebar.
    const menu = css('../components/layout/Sidebar.css').match(/\.spaces-menu\s*\{[^}]*\}/)[0]
    const minWidth = Number(menu.match(/min-width:\s*(\d+)px/)[1])
    expect(minWidth).toBeLessThanOrEqual(190)
  })

  it('the Backlog toolbar wraps instead of squeezing the Sort select; issue keys do not wrap', () => {
    const backlog = css('../pages/BacklogPage/BacklogPage.css')
    expect(backlog).toMatch(/\.backlog-toolbar-left\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(backlog).toMatch(/\.backlog-issue-main small\s*\{[^}]*white-space:\s*nowrap/)
  })

  it('assignee chips are no longer coloured by position', () => {
    expect(css('../pages/BacklogPage/BacklogPage.css')).not.toMatch(/\.assignee-chip:nth-child/)
  })
})

// --- Backlog rendering: counts and chips ----------------------------------------
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ loaded: true, isAdmin: true, canCreateIssue: true, canEditIssue: true, canDeleteIssue: true, canManageSprints: true, canExportIssues: true }),
}))
vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({ sprints: SPRINTS, handleCreateSprint: vi.fn(), handleStartSprint: vi.fn(), handleUpdateSprint: vi.fn(), handleDeleteSprint: vi.fn() }),
}))
const SPRINTS = [{ id: 10, projectId: 1, name: 'TP Sprint 1', dateRange: '7 Dec - 21 Dec', isStarted: false }]
const ISSUES = [
  { id: 1, key: 'TP-1', title: 'In sprint', status: 'To Do', priority: 'Low', issueType: 'Task', assignee: 'Alice', sprintId: 10, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Backlog one', status: 'Backlog', priority: 'Low', issueType: 'Task', assignee: 'Bob', sprintId: null, projectId: 1 },
  { id: 3, key: 'TP-3', title: 'Backlog two', status: 'Backlog', priority: 'Low', issueType: 'Task', assignee: 'Bob', sprintId: null, projectId: 1 },
]
vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: ISSUES, handleMove: vi.fn(), handleCreate: vi.fn(), reloadIssues: vi.fn() }),
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ profile: { full_name: 'Lee' }, members: [{ id: 1, name: 'Alice Doe' }, { id: 2, name: 'Bob Roe' }] }),
}))
vi.mock('../api/issueConfigApi', () => ({ fetchProjectStatuses: vi.fn(async () => []), fetchProjectPriorities: vi.fn(async () => []) }))
vi.mock('../api/labelApi', () => ({ fetchProjectLabels: vi.fn(async () => []) }))
vi.mock('../api/dependencyApi', () => ({ fetchProjectDependencies: vi.fn(async () => ({ byId: {}, edges: [], cycles: [], blockedCount: 0 })) }))
vi.mock('../api/issueApi', () => ({ bulkChangeIssues: vi.fn() }))
vi.mock('../api/watcherApi', () => ({ watchIssue: vi.fn(), unwatchIssue: vi.fn() }))

import { BacklogPage } from '../pages/BacklogPage/BacklogPage'
import { avatarStyle } from '../utils/avatarColour'

function renderBacklog() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/backlog']}>
      <Routes><Route path="/projects/:projectId/backlog" element={<BacklogPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('Backlog rendering', () => {
  it('says "1 work item" (singular) and "2 work items"', () => {
    renderBacklog()
    expect(screen.getByText('(1 work item)')).toBeInTheDocument()
    expect(screen.getByText('(2 work items)')).toBeInTheDocument()
  })

  it('colours each assignee chip by the person, with the shared accessible palette', () => {
    renderBacklog()
    const chip = screen.getByRole('button', { name: 'Filter by assignee Bob Roe' })
    const expected = avatarStyle('Bob Roe')
    expect(chip.style.background).toBe(expected.background)
    expect(chip.style.color).toBe(expected.color)
  })
})
