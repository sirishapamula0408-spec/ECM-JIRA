// JL-397 — the three standard Jira list fields (Reporter, Updated, Story Points)
// and the ListViewControls pinnedColumns prop.
//
// The original "Type/Key/Summary are pinned as three columns" block is GONE, not
// skipped: JL-398 merged those three into one fixed "Work" column, so the shape
// it asserted no longer exists by design. Its replacement is
// ListWorkColumn.JL398.test.jsx. What remains here is everything JL-398 did not
// touch, plus the generic pinning contract the Work column now relies on.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { mockFetchListViews, mockCreateListView, mockUpdateListView, mockDeleteListView } =
  vi.hoisted(() => ({
    mockFetchListViews: vi.fn(),
    mockCreateListView: vi.fn(),
    mockUpdateListView: vi.fn(),
    mockDeleteListView: vi.fn(),
  }))

vi.mock('../api/listViewApi', () => ({
  fetchListViews: mockFetchListViews,
  createListView: mockCreateListView,
  updateListView: mockUpdateListView,
  deleteListView: mockDeleteListView,
  DEFAULT_COLUMNS: ['key', 'summary', 'status'],
  COLUMN_LABELS: { key: 'Key', summary: 'Summary', status: 'Status' },
}))

// Alpha carries a value for every new field, plus story points of 0 — a real
// estimate that a naive falsy check would mistake for "no value".
// Gamma is the empty case: every new field null.
const ISSUES = [
  {
    id: 1, key: 'TP-1', title: 'Alpha', status: 'To Do', priority: 'Low', issueType: 'Task',
    assignee: 'Bob', sprintId: null, projectId: 1,
    reporter: 'Dana Scully', storyPoints: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-03-03T00:00:00Z', dueDate: '2026-04-01',
  },
  {
    id: 2, key: 'TP-2', title: 'Beta', status: 'To Do', priority: 'High', issueType: 'Bug',
    assignee: 'Al', sprintId: null, projectId: 1,
    reporter: 'Fox Mulder', storyPoints: 5,
    createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z', dueDate: '2026-04-02',
  },
  {
    id: 3, key: 'TP-3', title: 'Gamma', status: 'Done', priority: 'Medium', issueType: 'Story',
    assignee: 'Cy', sprintId: null, projectId: 1,
    reporter: null, storyPoints: null,
    createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-03-02T00:00:00Z', dueDate: null,
  },
]

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: ISSUES, handleCreate: vi.fn(), handleMove: vi.fn(),
    handleUpdate: vi.fn(), handleDelete: vi.fn(),
  }),
}))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { name: 'Alex Rivera', email: 'alex@test.com' } }),
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ profile: { full_name: 'Alex Rivera' } }),
}))

import { IssueListPage } from '../pages/ListPage/IssueListPage'
import { ListViewControls } from '../components/listViews/ListViewControls'

function renderPage() {
  return render(<MemoryRouter><IssueListPage /></MemoryRouter>)
}

/** Add one of the optional columns via the in-table "+" menu. */
function addColumn(label) {
  fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: new RegExp(label, 'i') }))
}

/** The <td> text of the row whose summary cell reads `summary`. */
function cellsFor(summary) {
  const link = Array.from(document.querySelectorAll('.jira-list-summary-link'))
    .find((el) => el.textContent === summary)
  return Array.from(link.closest('tr').querySelectorAll('td')).map((td) => td.textContent.trim())
}

const summaryOrder = () =>
  Array.from(document.querySelectorAll('.jira-list-summary-link')).map((e) => e.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchListViews.mockResolvedValue([])
})

describe('JL-397 — the three standard Jira fields', () => {
  it('offers Reporter, Updated and Story Points as columns', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    for (const label of ['Reporter', 'Updated', 'Story Points']) {
      expect(screen.getByRole('menuitemcheckbox', { name: new RegExp(label, 'i') }), label)
        .toBeInTheDocument()
    }
  })

  it('renders a real reporter, and a dash when there is none', () => {
    renderPage()
    addColumn('Reporter')
    expect(cellsFor('Alpha')).toContain('Dana Scully')
    expect(cellsFor('Gamma')).toContain('-')
  })

  it('renders story points including a genuine 0, and a dash when unset', () => {
    renderPage()
    addColumn('Story Points')
    // 0 is an estimate, not an absence — this is the falsy-check trap.
    expect(cellsFor('Alpha')).toContain('0')
    expect(cellsFor('Beta')).toContain('5')
    expect(cellsFor('Gamma')).toContain('-')
  })

  it('renders Updated from real data rather than a placeholder', () => {
    renderPage()
    addColumn('Updated')
    const alpha = cellsFor('Alpha')
    expect(alpha.some((text) => text && text !== '-' && /ago|hour|day|month|year|\d/.test(text)))
      .toBe(true)
  })

  it('renders Due Date from real data — it used to be a hardcoded dash', () => {
    renderPage()
    addColumn('Due Date')
    // Alpha has a due date and Gamma does not; if the cell were still the old
    // hardcoded '-', both rows would read identically.
    expect(cellsFor('Alpha')).not.toEqual(cellsFor('Gamma'))
    expect(cellsFor('Gamma')).toContain('-')
  })
})

describe('JL-397 — comparators for the new columns', () => {
  it('sorts story points numerically, with 0 ranking below 5 and blanks last', () => {
    renderPage()
    addColumn('Story Points')
    fireEvent.click(screen.getByRole('button', { name: /Story Points/i }))
    // asc: 0 (Alpha), 5 (Beta), then the missing value (Gamma) last.
    expect(summaryOrder()).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('sorts Updated chronologically, not as text', () => {
    renderPage()
    addColumn('Updated')
    fireEvent.click(screen.getByRole('button', { name: /Updated/i }))
    // Beta 03-01, Gamma 03-02, Alpha 03-03.
    expect(summaryOrder()).toEqual(['Beta', 'Gamma', 'Alpha'])
  })
})

describe('JL-397 — ListViewControls stays generic for other consumers', () => {
  it('pins nothing when pinnedColumns is not supplied', async () => {
    mockFetchListViews.mockResolvedValue([])
    render(
      <ListViewControls columns={['key', 'summary', 'status']} onColumnsChange={vi.fn()} />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Columns' }))
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeEnabled()
    expect(screen.queryByText(/always/i)).toBeNull()
  })

  it('refuses to remove a pinned column but still removes an unpinned one', async () => {
    const onColumnsChange = vi.fn()
    mockFetchListViews.mockResolvedValue([])
    render(
      <ListViewControls
        columns={['key', 'summary', 'status']}
        onColumnsChange={onColumnsChange}
        pinnedColumns={['key']}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Columns' }))

    const keyItem = screen.getByText('Key', { selector: '.lvc-col-label' }).closest('li')
    fireEvent.click(within(keyItem).getByRole('checkbox'))
    expect(onColumnsChange).not.toHaveBeenCalled()

    const statusItem = screen.getByText('Status', { selector: '.lvc-col-label' }).closest('li')
    fireEvent.click(within(statusItem).getByRole('checkbox'))
    expect(onColumnsChange).toHaveBeenCalledWith(['key', 'summary'])
  })
})
