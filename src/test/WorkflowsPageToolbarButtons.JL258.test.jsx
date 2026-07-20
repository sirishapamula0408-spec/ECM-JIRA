// JL-258 — The List toolbar's two icon buttons must not be dead affordances.
// "Display settings" is wired to a real popover menu (backed by the existing
// column-visibility toggles) and exposes aria-haspopup/aria-expanded. The dead
// "More options" button (no backing behavior) is removed rather than left as a
// clickable no-op.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const ISSUES = [
  { id: 1, key: 'TP-1', title: 'First', status: 'To Do', priority: 'High', issueType: 'Task', assignee: 'Alice', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Second', status: 'Done', priority: 'Low', issueType: 'Bug', assignee: 'Bob', sprintId: null, projectId: 1 },
]

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: ISSUES, handleCreate: vi.fn(), handleMove: vi.fn() }),
}))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { name: 'Alex Rivera', email: 'alex@test.com' } }),
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ profile: { full_name: 'Alex Rivera' } }),
}))

import { WorkflowsPage } from '../pages/WorkflowsPage/WorkflowsPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkflowsPage />
    </MemoryRouter>,
  )
}

describe('JL-258 — List toolbar buttons are functional, not dead affordances', () => {
  beforeEach(() => vi.clearAllMocks())

  it('"Display settings" is a menu button with aria-haspopup and aria-expanded', () => {
    renderPage()
    const btn = screen.getByRole('button', { name: 'Display settings' })
    expect(btn).toHaveAttribute('aria-haspopup', 'menu')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens a real menu on click and toggles aria-expanded', () => {
    renderPage()
    const btn = screen.getByRole('button', { name: 'Display settings' })

    // No menu before click.
    expect(screen.queryByRole('menuitemcheckbox', { name: /Priority/ })).toBeNull()

    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    // Menu is populated with the existing column-visibility toggles.
    expect(screen.getByRole('menuitemcheckbox', { name: /Priority/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: /Due Date/ })).toBeInTheDocument()
  })

  it('menu items actually toggle column visibility (real backing behavior)', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Display settings' }))

    // "Priority" column not shown as a table header yet.
    const header = () => document.querySelector('.jira-list-table thead')
    expect(header().textContent).not.toContain('Priority')

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Priority/ }))
    expect(header().textContent).toContain('Priority')
  })

  it('does not render the dead "More options" button', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull()
  })
})
