// JL-455 — deleting from the List view.
//
// Reported as "I couldn't find single record delete or bulk record delete
// option in /list page". Both halves were real, but for different reasons:
//
//   * Per-row delete genuinely did not exist. `handleDelete` had exactly one
//     call site in the whole page, inside the bulk handler. There was no row
//     menu of any kind.
//   * Bulk delete existed and worked (JL-257), but was an <option> inside a
//     dropdown that defaulted to "Status" and only appeared after ticking a
//     checkbox. Nothing on first load suggested deletion was possible.
//
// So this file guards two things: that one row can be deleted on its own, and
// that bulk delete is reachable WITHOUT operating a dropdown first. The second
// is the regression that would silently undo this ticket — the feature would
// still "work" and still be unfindable.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'

const ROWS = [
  { id: 1, key: 'TP-1', title: 'First', status: 'To Do', priority: 'Medium', issueType: 'Task', assignee: 'Alice', sprintId: 7, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Second', status: 'To Do', priority: 'Low', issueType: 'Bug', assignee: 'Bob', sprintId: null, projectId: 1 },
  { id: 3, key: 'TP-3', title: 'Third', status: 'In Progress', priority: 'High', issueType: 'Story', assignee: 'Carol', sprintId: 7, projectId: 1 },
]

const handleDelete = vi.fn(() => Promise.resolve())

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: ROWS, handleCreate: vi.fn(), handleMove: vi.fn(), handleUpdate: vi.fn(), handleDelete }),
}))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [{ id: 7, name: 'Sprint 7' }] }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ authUser: { name: 'Alex Rivera', email: 'alex@test.com' } }) }))

// Role is swapped per-describe; usePermissions reads currentMember.
let member = { workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ profile: { full_name: 'Alex Rivera' }, currentMember: member }),
}))

import { IssueListPage } from '../pages/ListPage/IssueListPage'

const renderPage = () => render(<MemoryRouter><IssueListPage /></MemoryRouter>)
const rowMenu = (key) => screen.getByRole('button', { name: `Actions for ${key}` })
const bulkBar = () => screen.queryByRole('region', { name: 'Bulk actions' })

async function confirmDialog(button) {
  const dialog = await screen.findByRole('dialog')
  await fireEvent.click(within(dialog).getByRole('button', { name: button }))
}

describe('JL-455 — per-row delete', () => {
  beforeEach(() => {
    member = { workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
    vi.clearAllMocks()
  })

  it('offers a row action menu on every row', () => {
    renderPage()
    expect(rowMenu('TP-1')).toBeInTheDocument()
    expect(rowMenu('TP-2')).toBeInTheDocument()
    expect(rowMenu('TP-3')).toBeInTheDocument()
  })

  it('deletes exactly the one issue, with no checkbox involved', async () => {
    renderPage()
    // Deliberately select nothing. The whole point of this ticket is that
    // deleting one issue must not require driving the bulk selection.
    fireEvent.click(rowMenu('TP-2'))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await confirmDialog('Delete')

    expect(handleDelete).toHaveBeenCalledTimes(1)
    expect(handleDelete).toHaveBeenCalledWith(2)
  })

  it('names the issue in the confirmation, so it is clear which row is going', async () => {
    renderPage()
    fireEvent.click(rowMenu('TP-3'))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/TP-3/)
    // Singular — "Delete 1 issue(s)?" is the kind of copy this guards against.
    expect(dialog.textContent).toMatch(/Delete issue\?/)
  })

  it('cancelling deletes nothing', async () => {
    renderPage()
    fireEvent.click(rowMenu('TP-1'))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await confirmDialog('Cancel')
    expect(handleDelete).not.toHaveBeenCalled()
  })

  it('leaves an unrelated selection intact', async () => {
    // A row-menu delete is scoped to its own row. Clearing the whole selection
    // as a side effect would silently discard work the user had queued up.
    renderPage()
    fireEvent.click(screen.getByLabelText('Select TP-1'))
    fireEvent.click(screen.getByLabelText('Select TP-3'))
    expect(within(bulkBar()).getByText('2 selected')).toBeInTheDocument()

    fireEvent.click(rowMenu('TP-2'))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await confirmDialog('Delete')

    expect(handleDelete).toHaveBeenCalledWith(2)
    await waitFor(() => expect(within(bulkBar()).getByText('2 selected')).toBeInTheDocument())
  })

  it('opens one menu at a time', () => {
    renderPage()
    fireEvent.click(rowMenu('TP-1'))
    expect(screen.getAllByRole('menuitem', { name: 'Delete' })).toHaveLength(1)
    fireEvent.click(rowMenu('TP-2'))
    expect(screen.getAllByRole('menuitem', { name: 'Delete' })).toHaveLength(1)
  })
})

describe('JL-455 — bulk delete is reachable without a dropdown', () => {
  beforeEach(() => {
    member = { workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
    vi.clearAllMocks()
  })

  it('is a labelled button, not an option inside the bulk picker', () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Select TP-1'))

    // The regression this exists to catch: delete going back inside the picker,
    // where it is invisible until the dropdown is opened.
    const picker = screen.getByLabelText('Bulk action')
    expect(Array.from(picker.querySelectorAll('option')).map((o) => o.value)).not.toContain('delete')
    expect(screen.getByRole('button', { name: 'Delete 1 issue' })).toBeInTheDocument()
  })

  it('counts what will be deleted, and pluralises honestly', () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Select TP-1'))
    expect(screen.getByRole('button', { name: 'Delete 1 issue' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Select TP-2'))
    expect(screen.getByRole('button', { name: 'Delete 2 issues' })).toBeInTheDocument()
  })

  it('deletes every selected id and drops them from the selection', async () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Select TP-1'))
    fireEvent.click(screen.getByLabelText('Select TP-3'))
    await fireEvent.click(screen.getByRole('button', { name: 'Delete 2 issues' }))
    await confirmDialog('Delete')

    expect(handleDelete).toHaveBeenCalledTimes(2)
    expect(handleDelete).toHaveBeenCalledWith(1)
    expect(handleDelete).toHaveBeenCalledWith(3)
    await waitFor(() => expect(bulkBar()).not.toBeInTheDocument())
  })
})

describe('JL-455 — Viewers gain no delete route', () => {
  beforeEach(() => {
    // Workspace Viewer with no project role: canDeleteIssue false.
    member = { workspaceRole: 'Viewer', isOwner: false, projectRoles: [] }
    vi.clearAllMocks()
  })

  it('shows no row action menu', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull()
  })

  it('shows no bulk delete button, because it shows no bulk bar at all', () => {
    renderPage()
    expect(screen.queryByLabelText('Select TP-1')).toBeNull()
    expect(bulkBar()).toBeNull()
    expect(screen.queryByRole('button', { name: /^Delete \d+ issue/ })).toBeNull()
  })
})

/* ── JL-462: the trigger's appearance ──────────────────────────────────────
 *
 * JL-455 shipped this control verified by test suite but never seen rendered —
 * the local login form does not complete — and it looked wrong: a horizontal
 * ellipsis on the text baseline, visible on every row at once.
 *
 * The behavioural half is asserted by rendering. The presentational half lives
 * entirely in CSS that jsdom does not load, so those rules are asserted against
 * the stylesheet source. That is weaker than a computed style, and deliberately
 * chosen over a test that would pass with the rules deleted.
 */
describe('JL-462 — the row-actions trigger reads as a control', () => {
  beforeEach(() => {
    member = { workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
    vi.clearAllMocks()
  })

  it('renders an icon, not the ellipsis character it shipped with', () => {
    renderPage()
    const trigger = rowMenu('TP-1')
    expect(trigger.querySelector('svg')).toBeTruthy()
    // "…" reads as omitted text rather than "there are actions here".
    expect(trigger.textContent).not.toContain('\u2026')
  })

  it('keeps the icon out of the accessible name', () => {
    // The SVG is decorative; the button already says what it is.
    renderPage()
    const trigger = rowMenu('TP-2')
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(trigger).toHaveAccessibleName('Actions for TP-2')
  })
})

describe('JL-462 — the stylesheet carries the reveal and flip rules', () => {
  const css = readListCss()

  it('hides the trigger until its row is hovered', () => {
    expect(css).toMatch(/\.jira-list-row-menu-trigger \{[^}]*opacity: 0;/)
    expect(css).toContain('.jira-list-table tbody tr:hover .jira-list-row-menu-trigger')
  })

  it('pins it visible for keyboard users and while the menu is open', () => {
    // The regression that would make this control unusable without a mouse:
    // hover-reveal alone means tabbing to an invisible button.
    expect(css).toContain('.jira-list-row-menu-trigger:focus-visible')
    expect(css).toMatch(/\.jira-list-row-menu-trigger\[aria-expanded='true'\][\s\S]{0,200}opacity: 1;/)
  })

  it('centres the glyph rather than leaving it on the baseline', () => {
    expect(css).toMatch(/\.jira-list-row-menu-trigger \{[^}]*display: inline-flex;/)
    expect(css).toMatch(/\.jira-list-row-menu-trigger \{[^}]*justify-content: center;/)
  })

  it('opens the menu upward on the last rows so it is not clipped', () => {
    expect(css).toMatch(/tr:nth-last-child\(-n \+ 2\) \.jira-list-row-menu \{[^}]*bottom: 100%;/)
  })
})

function readListCss() {
  return fs.readFileSync(path.join(process.cwd(), 'src/pages/ListPage/IssueListPage.css'), 'utf8')
}
