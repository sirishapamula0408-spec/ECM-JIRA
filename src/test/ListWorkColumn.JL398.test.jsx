// JL-398 — the unified "Work" column on the List view.
//
// Replaces the "Type/Key/Summary are pinned as three columns" block that used to
// live in ListColumns.JL397.test.jsx. JL-397 read Atlassian's older docs page
// ("you'll always see the type, key, and summary fields") and pinned three
// separate columns; the current product merges them into one column that is
// "fixed in position and can't be moved". So the rule survives — this
// information cannot be removed — but the shape changed, including JL-397's
// "pinned means non-removable, not frozen" conclusion, which is reversed here.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Permission mock (mutated per test, as in ListView.rbac.test.jsx) ──
let mockPerms = {}
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => mockPerms }))

const MEMBER_PERMS = { loaded: true, canCreateIssue: true, canEditIssue: true, canDeleteIssue: true }
const VIEWER_PERMS = { loaded: true, canCreateIssue: false, canEditIssue: false, canDeleteIssue: false }

const { mockFetchListViews, mockCreateSubtask } = vi.hoisted(() => ({
  mockFetchListViews: vi.fn(),
  mockCreateSubtask: vi.fn(),
}))

vi.mock('../api/listViewApi', () => ({
  fetchListViews: mockFetchListViews,
  createListView: vi.fn(),
  updateListView: vi.fn(),
  deleteListView: vi.fn(),
  DEFAULT_COLUMNS: ['work', 'status'],
  COLUMN_LABELS: { work: 'Work', status: 'Status' },
}))

vi.mock('../api/issueApi', () => ({ createSubtask: mockCreateSubtask }))

const ROWS = [
  { id: 1, key: 'TP-1', title: 'Banana', status: 'To Do', priority: 'Low', issueType: 'Task', assignee: 'Bob', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Apple', status: 'To Do', priority: 'High', issueType: 'Bug', assignee: 'Al', sprintId: null, projectId: 1 },
  // A Sub-task: the API refuses a child under a child, so no "+" may appear here.
  { id: 3, key: 'TP-3', title: 'Cherry', status: 'Done', priority: 'Medium', issueType: 'Sub-task', assignee: 'Cy', sprintId: null, projectId: 1, parentId: 1 },
]

const reloadIssues = vi.fn(() => Promise.resolve())

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: ROWS,
    handleCreate: vi.fn(), handleMove: vi.fn(), handleUpdate: vi.fn(), handleDelete: vi.fn(),
    reloadIssues,
  }),
}))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ authUser: { name: 'Alex Rivera', email: 'alex@test.com' } }) }))
vi.mock('../context/MemberContext', () => ({ useMembers: () => ({ profile: { full_name: 'Alex Rivera' } }) }))

import { IssueListPage } from '../pages/ListPage/IssueListPage'

const renderPage = () => render(<MemoryRouter><IssueListPage /></MemoryRouter>)

/** Labelled column headers in render order. The bulk-select checkbox header has
 *  no text and is dropped, so these assertions describe the actual columns. */
const headerNames = () =>
  screen.getAllByRole('columnheader').map((th) => th.textContent.trim()).filter(Boolean)

const workHeader = () => screen.getByRole('columnheader', { name: /Work/i })

/** The Work header's own sort trigger. Scoped to the header because each row
 *  also has an "Open work item …" button, which a bare /Work/i would match. */
const workSortTrigger = () => within(workHeader()).getByRole('button')

/** The <tr> whose Work cell shows `summary`. */
function rowFor(summary) {
  const link = Array.from(document.querySelectorAll('.jira-list-summary-link'))
    .find((el) => el.textContent === summary)
  return link.closest('tr')
}

function sortWorkBy(attr) {
  fireEvent.click(workSortTrigger())
  fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(`Sort by ${attr}`, 'i') }))
}

const summaryOrder = () =>
  Array.from(document.querySelectorAll('.jira-list-summary-link')).map((e) => e.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  mockPerms = MEMBER_PERMS
  mockFetchListViews.mockResolvedValue([])
  mockCreateSubtask.mockResolvedValue({ id: 99, key: 'TP-9', title: 'New child' })
})

describe('JL-398 — one fixed Work column', () => {
  it('renders Work first and no separate Type/Key/Summary columns', () => {
    renderPage()
    expect(headerNames()[0]).toMatch(/^Work/)
    for (const gone of ['Type', 'Key', 'Summary']) {
      expect(
        screen.queryByRole('columnheader', { name: new RegExp(`^${gone}$`, 'i') }),
        `${gone} should no longer be its own column`,
      ).toBeNull()
    }
  })

  it('does not offer Type, Key or Summary as individual columns in any menu', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    for (const gone of ['Type', 'Key', 'Summary']) {
      expect(
        screen.queryByRole('menuitemcheckbox', { name: new RegExp(`^${gone}$`, 'i') }),
        gone,
      ).toBeNull()
    }
  })

  it('is neither removable nor reorderable in the picker — fixed, not just pinned', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Columns' }))
    const item = screen.getByText('Work', { selector: '.lvc-col-label' }).closest('li')
    const box = within(item).getByRole('checkbox')
    expect(box).toBeChecked()
    expect(box).toBeDisabled()
    expect(within(item).getByText(/always/i)).toBeInTheDocument()
    // Fixed position: it is first, so "up" is unavailable, and unlike JL-397's
    // pinned columns it must not be movable down either.
    expect(within(item).getByRole('button', { name: /Move Work up/i })).toBeDisabled()
  })

  it('carries no drag handle, so it cannot be dragged out of first place', () => {
    renderPage()
    expect(workHeader().querySelector('.col-drag-handle')).toBeNull()
    expect(workHeader()).not.toHaveAttribute('draggable', 'true')
    // A movable column still has its handle — the fixed one is the exception.
    expect(
      screen.getByRole('columnheader', { name: /Status/i }).querySelector('.col-drag-handle'),
    ).not.toBeNull()
  })

  it('migrates a saved view that still names type/key/summary', async () => {
    mockFetchListViews.mockResolvedValue([
      { id: 10, name: 'Legacy', columns: ['type', 'key', 'summary', 'status'], filterJql: null, isDefault: true, projectId: 1 },
    ])
    renderPage()
    // The three legacy keys collapse to one Work column rather than being
    // dropped (unidentifiable rows) or passed through (unknown-key crash).
    await waitFor(() => {
      expect(headerNames()).toEqual(['Work⋯', 'Status', '+'])
    }, { timeout: 5000 })
  })
})

describe('JL-398 — the Work cell', () => {
  it('shows the type icon, the key and the summary', () => {
    renderPage()
    const row = rowFor('Banana')
    expect(within(row).getByText('TP-1')).toBeInTheDocument()
    expect(within(row).getByText('Banana')).toBeInTheDocument()
    expect(row.querySelector('.list-type-mark')).not.toBeNull()
  })

  it('links to the item from both the key and the summary', () => {
    renderPage()
    const row = rowFor('Banana')
    expect(within(row).getByText('TP-1').className).toContain('jira-list-key-link')
    expect(within(row).getByText('Banana').className).toContain('jira-list-summary-link')
  })

  it('offers an "open work item" action on every row', () => {
    renderPage()
    expect(within(rowFor('Banana')).getByRole('button', { name: /Open work item TP-1/i }))
      .toBeInTheDocument()
    expect(within(rowFor('Cherry')).getByRole('button', { name: /Open work item TP-3/i }))
      .toBeInTheDocument()
  })
})

describe('JL-398 — create child item', () => {
  it('offers "+" on a normal row', () => {
    renderPage()
    expect(within(rowFor('Banana')).getByRole('button', { name: /Create child item under TP-1/i }))
      .toBeInTheDocument()
  })

  it('hides "+" on a Sub-task row, because the API rejects a child of a child', () => {
    renderPage()
    // TP-3 is a Sub-task. POST /issues/:id/subtasks would 400 here, so shipping
    // the control would guarantee a failure.
    expect(within(rowFor('Cherry')).queryByRole('button', { name: /Create child item/i }))
      .toBeNull()
    // The open action is unaffected.
    expect(within(rowFor('Cherry')).getByRole('button', { name: /Open work item/i }))
      .toBeInTheDocument()
  })

  it('hides both write affordances from a Viewer but keeps the item openable', () => {
    mockPerms = VIEWER_PERMS
    renderPage()
    expect(screen.queryByRole('button', { name: /Create child item/i })).toBeNull()
    expect(within(rowFor('Banana')).getByRole('button', { name: /Open work item TP-1/i }))
      .toBeInTheDocument()
  })

  it('creates a real sub-task and refreshes the list without a manual reload', async () => {
    renderPage()
    fireEvent.click(within(rowFor('Banana')).getByRole('button', { name: /Create child item under TP-1/i }))

    const input = screen.getByLabelText(/Summary for the new child item of TP-1/i)
    fireEvent.change(input, { target: { value: 'Write the migration' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mockCreateSubtask).toHaveBeenCalledTimes(1))
    // Posts against the PARENT's id, which is what the endpoint keys on.
    expect(mockCreateSubtask.mock.calls[0][0]).toBe(1)
    expect(mockCreateSubtask.mock.calls[0][1]).toMatchObject({ title: 'Write the migration' })
    await waitFor(() => expect(reloadIssues).toHaveBeenCalled())
  })

  it('refuses an empty summary without calling the API', async () => {
    renderPage()
    fireEvent.click(within(rowFor('Banana')).getByRole('button', { name: /Create child item under TP-1/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }))
    expect(await screen.findByText(/Summary is required/i)).toBeInTheDocument()
    expect(mockCreateSubtask).not.toHaveBeenCalled()
  })

  it('surfaces a failure instead of silently swallowing it', async () => {
    mockCreateSubtask.mockRejectedValue(new Error('Cannot create a sub-task under another sub-task.'))
    renderPage()
    fireEvent.click(within(rowFor('Banana')).getByRole('button', { name: /Create child item under TP-1/i }))
    const input = screen.getByLabelText(/Summary for the new child item of TP-1/i)
    fireEvent.change(input, { target: { value: 'Doomed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText(/Cannot create a sub-task under another sub-task/i))
      .toBeInTheDocument()
  })

  it('closes the form on Escape', () => {
    renderPage()
    fireEvent.click(within(rowFor('Banana')).getByRole('button', { name: /Create child item under TP-1/i }))
    const input = screen.getByLabelText(/Summary for the new child item of TP-1/i)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText(/Summary for the new child item/i)).toBeNull()
  })
})

describe('JL-398 — sorting survives the merge', () => {
  it('offers key, type and summary as sort attributes on the Work header', () => {
    renderPage()
    fireEvent.click(workSortTrigger())
    for (const attr of ['key', 'type', 'summary']) {
      expect(screen.getByRole('menuitemradio', { name: new RegExp(`Sort by ${attr}`, 'i') }), attr)
        .toBeInTheDocument()
    }
  })

  it('sorts by summary and reports aria-sort on the Work header', () => {
    renderPage()
    sortWorkBy('summary')
    expect(summaryOrder()).toEqual(['Apple', 'Banana', 'Cherry'])
    expect(workHeader()).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts by key', () => {
    renderPage()
    sortWorkBy('key')
    expect(summaryOrder()).toEqual(['Banana', 'Apple', 'Cherry']) // TP-1, TP-2, TP-3
    expect(workHeader()).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts by type', () => {
    renderPage()
    sortWorkBy('type')
    // Bug, Sub-task, Task alphabetically.
    expect(summaryOrder()).toEqual(['Apple', 'Cherry', 'Banana'])
  })

  it('reports aria-sort none while an unrelated column is the sort key', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Status/i }))
    expect(workHeader()).toHaveAttribute('aria-sort', 'none')
  })
})
