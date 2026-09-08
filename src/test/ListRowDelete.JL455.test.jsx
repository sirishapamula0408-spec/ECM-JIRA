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
import { ISSUE_STATUSES } from '../constants'
import { CATEGORY_GLYPH } from '../utils/statusCategory'

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
    expect(screen.getByRole('button', { name: 'Delete 1 selected issue' })).toBeInTheDocument()
  })

  it('counts what will be deleted, and pluralises honestly', () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Select TP-1'))
    expect(screen.getByRole('button', { name: 'Delete 1 selected issue' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Select TP-2'))
    expect(screen.getByRole('button', { name: 'Delete 2 selected issues' })).toBeInTheDocument()
  })

  it('deletes every selected id and drops them from the selection', async () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Select TP-1'))
    fireEvent.click(screen.getByLabelText('Select TP-3'))
    await fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected issues' }))
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

/* ── JL-463: the bulk bar floats instead of pushing the table ──────────────
 *
 * It was an in-flow block above the table, so ticking a checkbox reflowed the
 * page and every row shifted. The reserve class below is real behaviour and is
 * asserted by rendering; the positioning itself is CSS that jsdom does not
 * load, so those rules are checked against the stylesheet source — weaker than
 * a computed style, and chosen over a test that would pass with the rules gone.
 */
describe('JL-463 — the table reserves room for the floating bar', () => {
  beforeEach(() => {
    member = { workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
    vi.clearAllMocks()
  })

  const scroller = (c) => c.querySelector('.jira-list-table-scroll')

  it('adds the reserve class only while rows are selected', () => {
    const { container } = renderPage()
    expect(scroller(container).className).not.toMatch(/--bulk/)

    fireEvent.click(screen.getByLabelText('Select TP-1'))
    expect(scroller(container).className).toMatch(/--bulk/)
  })

  it('drops it again when the selection is cleared', async () => {
    const { container } = renderPage()
    fireEvent.click(screen.getByLabelText('Select TP-1'))
    expect(scroller(container).className).toMatch(/--bulk/)

    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(scroller(container).className).not.toMatch(/--bulk/))
  })
})

describe('JL-463 — the stylesheet floats the bar correctly', () => {
  const css = readListCss()
  const barRule = css.match(/\.jira-list-bulk-bar \{[^}]*\}/)[0]

  it('takes the bar out of flow so the table cannot reflow', () => {
    expect(barRule).toMatch(/position: fixed;/)
    // The in-flow spacing that caused the shift must be gone, not just overridden.
    expect(barRule).not.toMatch(/margin-bottom:/)
  })

  it('layers it above the table menus but below dialogs', () => {
    // The specific failure this prevents: the delete confirmation opening
    // BEHIND the bar that launched it. Table menus are z-index 20; MUI
    // dialogs are 1300.
    const z = Number(barRule.match(/z-index: (\d+);/)[1])
    expect(z).toBeGreaterThan(20)
    expect(z).toBeLessThan(1300)
  })

  it('honours prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,160}\.jira-list-bulk-bar[\s\S]{0,80}animation: none;/)
  })

  it('keeps the centring transform in the animation keyframes', () => {
    // translateX(-50%) does the centring. A keyframe that animates `transform`
    // without repeating it would fling the bar to the right of the viewport.
    const frames = css.match(/@keyframes jira-list-bulk-bar-in \{[\s\S]*?\n\}/)[0]
    expect(frames.match(/translateX\(-50%\)/g) || []).toHaveLength(2)
  })
})

function readListCss() {
  return fs.readFileSync(path.join(process.cwd(), 'src/pages/ListPage/IssueListPage.css'), 'utf8')
}

/* ── JL-464: the button says "Delete", the count lives elsewhere ───────────
 *
 * JL-455 put the count in the visible label because the button had just
 * replaced an option inside a dropdown and had to carry its own scope. Once
 * JL-463 made the bar a compact floating pill, "Delete 2 issues" sat three
 * words from "2 selected" and the repetition was noise.
 *
 * The count did not disappear — it moved to the accessible name, because a
 * screen-reader user gets none of the visual adjacency that makes the short
 * label sufficient. Both halves are asserted here; testing only the visible
 * text would let the accessible name silently degrade to "Delete".
 */
describe('JL-464 — delete button label', () => {
  beforeEach(() => {
    member = { workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
    vi.clearAllMocks()
  })

  const deleteBtn = () => screen.getByRole('button', { name: /^Delete \d+ selected issue/ })

  it('shows just "Delete", without restating the count', () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Select TP-1'))
    fireEvent.click(screen.getByLabelText('Select TP-2'))

    expect(deleteBtn().textContent.trim()).toBe('Delete')
    // The bar already says it, immediately to the left.
    expect(within(bulkBar()).getByText('2 selected')).toBeInTheDocument()
  })

  it('keeps the count in the accessible name, pluralised honestly', () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Select TP-1'))
    expect(deleteBtn()).toHaveAccessibleName('Delete 1 selected issue')

    fireEvent.click(screen.getByLabelText('Select TP-2'))
    expect(deleteBtn()).toHaveAccessibleName('Delete 2 selected issues')
  })

  it('carries a decorative icon that stays out of the accessible name', () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Select TP-1'))
    const svg = deleteBtn().querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('still names the count in the confirmation, where it actually matters', async () => {
    // The last point before an irreversible action — the short label is fine on
    // the bar precisely because this dialog spells it out.
    renderPage()
    fireEvent.click(screen.getByLabelText('Select TP-1'))
    fireEvent.click(screen.getByLabelText('Select TP-3'))
    await fireEvent.click(deleteBtn())

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/2 issues/)
  })
})

/* ── JL-465: every status gets its own label ───────────────────────────────
 *
 * statusChip() hardcoded four statuses and sent everything else to 'TO DO'.
 * ISSUE_STATUSES has had nine entries since JL-306 added the QA lifecycle, so
 * the dropdowns showed "TO DO" five times over five different values — picking
 * one silently applied a status the user had not chosen.
 *
 * These expectations are DERIVED from ISSUE_STATUSES on purpose. A test that
 * listed the nine labels by hand would be the same hardcoded-list bug in the
 * test file, and would go green while a tenth status quietly regressed.
 */
describe('JL-465 — status dropdown labels', () => {
  beforeEach(() => {
    member = { workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
    vi.clearAllMocks()
  })

  const statusOptions = (container) =>
    [...container.querySelector('.jira-list-status-select').options]

  it('renders one option per canonical status, with no duplicate label', () => {
    const { container } = renderPage()
    const opts = statusOptions(container)

    expect(opts).toHaveLength(ISSUE_STATUSES.length)
    const labels = opts.map((o) => o.textContent.trim())
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('never labels a status "TO DO" unless it IS To Do', () => {
    // The exact defect: four QA statuses wearing To Do's label.
    const { container } = renderPage()
    for (const o of statusOptions(container)) {
      if (/\bTO DO\b/.test(o.textContent)) {
        expect(o.value, `"${o.textContent.trim()}" is labelled TO DO`).toBe('To Do')
      }
    }
  })

  it('shows each status its own name, keeping the one deliberate rename', () => {
    const { container } = renderPage()
    const byValue = Object.fromEntries(
      statusOptions(container).map((o) => [o.value, o.textContent.trim()]),
    )
    for (const status of ISSUE_STATUSES) {
      const expected = status === 'Code Review' ? 'IN REVIEW' : status.toUpperCase()
      expect(byValue[status], `label for "${status}"`).toContain(expected)
    }
  })

  it('makes the Cancelled glyph and its text agree', () => {
    // JL-457 gave Cancelled its own category, so it rendered "⊘ TO DO" —
    // the glyph and the words stating different things about one option.
    const { container } = renderPage()
    const cancelled = statusOptions(container).find((o) => o.value === 'Cancelled')
    expect(cancelled.textContent).toContain('CANCELLED')
    expect(cancelled.textContent).toContain(CATEGORY_GLYPH.cancelled)
  })

  it('keeps every option value exactly as stored', () => {
    // Labels changed; the values that get written to the API must not.
    const { container } = renderPage()
    expect(statusOptions(container).map((o) => o.value)).toEqual([...ISSUE_STATUSES])
  })
})
