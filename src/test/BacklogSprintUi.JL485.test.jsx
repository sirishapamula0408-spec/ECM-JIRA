// JL-485: three Backlog sprint-panel problems.
//  1. Completed sprints were still listed, with "Start sprint".
//  2. A long sprint name ran over the count pills (CSS; the name now carries a
//     title tooltip and is the part that shrinks).
//  3. Dark mode: the panel bars, rows and sidebar card stayed white.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

let mockPerms
let mockSprints
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => mockPerms }))
vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({ sprints: mockSprints, handleCreateSprint: vi.fn(), handleStartSprint: vi.fn(), handleUpdateSprint: vi.fn(), handleDeleteSprint: vi.fn() }),
}))
const ISSUES = [
  { id: 1, key: 'TP-1', title: 'Backlog story', status: 'Backlog', priority: 'Medium', issueType: 'Story', assignee: 'Alice', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Old sprint task', status: 'Done', priority: 'High', issueType: 'Task', assignee: 'Bob', sprintId: 9, projectId: 1 },
]
vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: ISSUES, handleMove: vi.fn(), handleCreate: vi.fn(), reloadIssues: vi.fn() }),
}))
vi.mock('../context/MemberContext', () => ({ useMembers: () => ({ profile: { full_name: 'Lee' }, members: [] }) }))
vi.mock('../api/issueConfigApi', () => ({ fetchProjectStatuses: vi.fn(async () => []), fetchProjectPriorities: vi.fn(async () => []) }))
vi.mock('../api/labelApi', () => ({ fetchProjectLabels: vi.fn(async () => []) }))
vi.mock('../api/dependencyApi', () => ({ fetchProjectDependencies: vi.fn(async () => ({ byId: {}, edges: [], cycles: [], blockedCount: 0 })) }))
vi.mock('../api/issueApi', () => ({ bulkChangeIssues: vi.fn() }))
vi.mock('../api/watcherApi', () => ({ watchIssue: vi.fn(), unwatchIssue: vi.fn() }))

import { BacklogPage } from '../pages/BacklogPage/BacklogPage'

const ADMIN = { loaded: true, isAdmin: true, canCreateIssue: true, canEditIssue: true, canDeleteIssue: true, canManageSprints: true, canExportIssues: true }
const LONG = 'TP Sprint 1 — checkout, payments, refunds, invoicing, tax, reconciliation and the reporting bundle'

function renderBacklog() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/backlog']}>
      <Routes><Route path="/projects/:projectId/backlog" element={<BacklogPage />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockPerms = { ...ADMIN }
  mockSprints = [
    { id: 9, projectId: 1, name: 'TP Sprint 0', dateRange: '1 Oct - 14 Oct', isStarted: true, completedAt: '2026-10-14T12:00:00Z' },
    { id: 10, projectId: 1, name: LONG, dateRange: '7 Dec - 21 Dec', isStarted: false, completedAt: null },
  ]
})

describe('1. completed sprints are not listed on the Backlog', () => {
  it('shows only the open sprint — no panel and no Start sprint for the completed one', () => {
    renderBacklog()
    expect(screen.queryByText('TP Sprint 0')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Start sprint' })).toHaveLength(1)
    expect(screen.getAllByLabelText('Sprint actions')).toHaveLength(1)
  })

  it('a completed sprint is not offered as a Move to target either', () => {
    renderBacklog()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for TP-1' }))
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([LONG])
  })
})

describe('2. long sprint names', () => {
  it('carry the full name as a tooltip, since the visible name may be cut short', () => {
    renderBacklog()
    expect(screen.getByText(LONG)).toHaveAttribute('title', LONG)
  })

  it('the title is the part that shrinks: its grid track can go below its content', () => {
    const css = readFileSync(resolve(__dirname, '../pages/BacklogPage/BacklogPage.css'), 'utf8')
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/)
    expect(css).toMatch(/\.jira-sprint-title strong\s*\{[^}]*text-overflow:\s*ellipsis/)
  })

  it('on a narrow column the title wraps instead of clipping "(N work items)"', () => {
    // Verification found "(3 w" at 768px: the count was flex: none inside overflow: hidden.
    const css = readFileSync(resolve(__dirname, '../pages/BacklogPage/BacklogPage.css'), 'utf8')
    expect(css).toMatch(/\.jira-sprint-row \.jira-sprint-left\s*\{[^}]*container-type:\s*inline-size/)
    // Re-verification: at 420px the name was squeezed to 12-25 chars on one line; wrap sooner.
    expect(css).toMatch(/@container \(max-width: 560px\)\s*\{[\s\S]*?\.jira-sprint-title\s*\{[^}]*flex-wrap:\s*wrap/)
  })

  it('on one line the goal gives way before the name', () => {
    const css = readFileSync(resolve(__dirname, '../pages/BacklogPage/BacklogPage.css'), 'utf8')
    expect(css).toMatch(/\.jira-sprint-title \.jira-sprint-goal\s*\{[^}]*flex:\s*0 1000 auto/)
    expect(css).toMatch(/\.jira-sprint-title strong\s*\{[^}]*flex:\s*0 1 auto/)
  })

  it('dates and count are separate pieces, so a wrap never splits "(N work items)"', () => {
    renderBacklog()
    const count = screen.getByText('(0 work items)', { selector: '.jira-sprint-count' })
    expect(count.closest('.jira-sprint-meta').querySelector('.jira-sprint-dates')).toHaveTextContent('7 Dec - 21 Dec')
  })

  it('"Delete sprint" carries a class the dark theme can recolour', () => {
    renderBacklog()
    fireEvent.click(screen.getAllByLabelText('Sprint actions')[0])
    expect(screen.getByRole('menuitem', { name: 'Delete sprint' })).toHaveClass('sprint-menu-danger')
  })
})

describe('3. dark mode', () => {
  const theme = readFileSync(resolve(__dirname, '../styles/theme.css'), 'utf8')
  for (const selector of [
    '.jira-sprint-row', '.jira-backlog-row', '.backlog-issue-row', '.sprint-issues.expanded', '.metric-pill',
    '.sprint-menu-trigger', '.backlog-row-more', '.sidebar-box',
    // Found in the browser check: these were dark-on-dark once the card went dark.
    '.sidebar .nav', '.sidebar .nav.active', '.sidebar-project-item--active', '.btn.sprint-action-btn', '.backlog-issue-link strong',
    // Found by independent verification: below 4.5:1, or no drag-over feedback.
    '.jira-sprint-row.drop-target-active', '.sprint-inline-create', '.bulk-count', '.sidebar-project-list-more',
    '.sprint-menu-danger', '.inline-action-btn',
  ]) {
    it(`has a dark rule for ${selector}`, () => {
      expect(theme).toContain(`.app-theme-dark ${selector}`)
    })
  }
})
