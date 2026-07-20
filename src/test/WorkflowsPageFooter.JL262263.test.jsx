// JL-262 — the List table must have a single horizontal scrollbar: the native
// `.jira-list-table-scroll { overflow-x: auto }` one. The redundant custom
// `.jira-list-scroll-track` element is removed.
// JL-263 — the custom prev/next pager is replaced by MUI TablePagination
// (rows-per-page 10/25/50), mirroring TeamsPage. Grouping (JL-259) must still be
// computed over the FULL filtered set and slicing must happen AFTER grouping, so
// group-header counts stay full-set correct under any page size.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// 30 "To Do" + 10 "Done" = 40 rows (reuses the JL-259 data shape).
const TODO = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  key: `TP-${i + 1}`,
  title: `To Do issue ${i + 1}`,
  status: 'To Do',
  priority: 'Medium',
  issueType: 'Task',
  assignee: 'Alice',
  sprintId: null,
  projectId: 1,
}))
const DONE = Array.from({ length: 10 }, (_, i) => ({
  id: 100 + i + 1,
  key: `DN-${i + 1}`,
  title: `Done issue ${i + 1}`,
  status: 'Done',
  priority: 'Low',
  issueType: 'Bug',
  assignee: 'Bob',
  sprintId: null,
  projectId: 1,
}))
const MANY = [...TODO, ...DONE]

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: MANY,
    handleCreate: vi.fn(),
    handleMove: vi.fn(),
    handleUpdate: vi.fn(),
    handleDelete: vi.fn(),
  }),
}))

vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({ sprints: [] }),
}))

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

function dataRows() {
  const tbody = document.querySelector('.jira-list-table tbody')
  return Array.from(tbody.querySelectorAll('tr')).filter(
    (tr) => !tr.classList.contains('jira-list-group-row'),
  )
}

function groupHeaders() {
  return Array.from(document.querySelectorAll('.jira-list-group-row')).map((el) => ({
    label: el.querySelector('strong')?.textContent,
    count: el.querySelector('span')?.textContent,
  }))
}

function setRowsPerPage(value) {
  fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: String(value) } })
}

describe('JL-262 — single horizontal scrollbar', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the native overflow-x scroll container', () => {
    renderPage()
    expect(document.querySelectorAll('.jira-list-table-scroll').length).toBe(1)
  })

  it('removes the redundant custom .jira-list-scroll-track element', () => {
    renderPage()
    expect(document.querySelector('.jira-list-scroll-track')).toBeNull()
  })
})

describe('JL-263 — MUI TablePagination replaces the custom pager', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the MUI pagination control (rows-per-page + next page)', () => {
    renderPage()
    expect(screen.getByLabelText('Rows per page')).toBeInTheDocument()
    expect(screen.getByLabelText('Go to next page')).toBeInTheDocument()
    // Default page size is 25 -> 25 rows on page 1 of 40, "1–25 of 40" label.
    expect(dataRows().length).toBe(25)
    expect(
      within(document.querySelector('.jira-list-pagination')).getByText('1–25 of 40'),
    ).toBeInTheDocument()
  })

  it('re-paginates when the rows-per-page size changes', () => {
    renderPage()
    setRowsPerPage(10)
    expect(dataRows().length).toBe(10)
    expect(
      within(document.querySelector('.jira-list-pagination')).getByText('1–10 of 40'),
    ).toBeInTheDocument()

    setRowsPerPage(50)
    // 50 > 40, so the whole set fits on one page.
    expect(dataRows().length).toBe(40)
    expect(
      within(document.querySelector('.jira-list-pagination')).getByText('1–40 of 40'),
    ).toBeInTheDocument()
  })

  it('clamps back to the first page when the page size grows on a later page', () => {
    renderPage()
    // Move to page 2 at the default size of 25.
    fireEvent.click(screen.getByLabelText('Go to next page'))
    expect(
      within(document.querySelector('.jira-list-pagination')).getByText('26–40 of 40'),
    ).toBeInTheDocument()

    // Growing the page size resets to page 1 (no out-of-range page).
    setRowsPerPage(50)
    expect(
      within(document.querySelector('.jira-list-pagination')).getByText('1–40 of 40'),
    ).toBeInTheDocument()
    expect(dataRows().length).toBe(40)
  })
})

describe('JL-263 — group-by counts stay full-set correct under variable page size', () => {
  beforeEach(() => vi.clearAllMocks())

  function enableGroupByStatus() {
    fireEvent.change(screen.getByDisplayValue('Group'), { target: { value: 'status' } })
  }

  it('shows full-set group totals with a small page size (10)', () => {
    renderPage()
    enableGroupByStatus()
    setRowsPerPage(10)

    // Only 10 rows on the page, but the group header count is the full 30.
    expect(dataRows().length).toBe(10)
    expect(groupHeaders()).toEqual([{ label: 'To Do', count: '30' }])
  })

  it('keeps groups contiguous with full counts across a page boundary (size 10)', () => {
    renderPage()
    enableGroupByStatus()
    setRowsPerPage(10)

    // 30 To Do then 10 Done. With size 10: page 4 (index 3) = 10 Done rows.
    const next = screen.getByLabelText('Go to next page')
    fireEvent.click(next) // page 2: To Do 11-20
    fireEvent.click(next) // page 3: To Do 21-30
    fireEvent.click(next) // page 4: Done 1-10

    expect(groupHeaders()).toEqual([{ label: 'Done', count: '10' }])
    expect(dataRows().length).toBe(10)
    expect(screen.getByText('DN-1')).toBeInTheDocument()
    expect(screen.queryByText('TP-30')).not.toBeInTheDocument()
  })
})
