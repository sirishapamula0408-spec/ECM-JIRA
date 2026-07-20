// JL-259 — List view "Group by" must group over the FULL filtered set, not just
// the current page. Group-header counts should reflect the true group total, and
// a group's rows should stay grouped across the page boundary.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// 30 "To Do" issues followed by 10 "Done" issues => 40 rows, spanning two pages
// (PAGE_SIZE = 25). Page 1 = 25 "To Do"; page 2 = 5 "To Do" + 10 "Done".
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
  useIssues: () => ({ issues: MANY, handleCreate: vi.fn(), handleMove: vi.fn() }),
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

function groupHeaders() {
  return Array.from(document.querySelectorAll('.jira-list-group-row')).map((el) => ({
    label: el.querySelector('strong')?.textContent,
    count: el.querySelector('span')?.textContent,
  }))
}

// Data (issue) rows = tbody rows that are not group-header rows.
function dataRows() {
  const tbody = document.querySelector('.jira-list-table tbody')
  return Array.from(tbody.querySelectorAll('tr')).filter(
    (tr) => !tr.classList.contains('jira-list-group-row'),
  )
}

function enableGroupByStatus() {
  fireEvent.change(screen.getByDisplayValue('Group'), { target: { value: 'status' } })
}

describe('JL-259 — List Group by covers the full filtered set', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the TRUE full-group total on the header, not the current page subset', () => {
    renderPage()
    enableGroupByStatus()

    // Page 1 shows only 25 "To Do" rows, but the header count must be 30 (the
    // full-set group total) — the whole point of the fix.
    const headers = groupHeaders()
    expect(headers).toEqual([{ label: 'To Do', count: '30' }])
    expect(dataRows().length).toBe(25)
  })

  it('keeps a group contiguous across the page boundary with full counts', () => {
    renderPage()
    enableGroupByStatus()

    // Go to page 2: remaining 5 "To Do" rows then 10 "Done" rows.
    fireEvent.click(screen.getByLabelText('Go to next page'))

    const headers = groupHeaders()
    expect(headers).toEqual([
      { label: 'To Do', count: '30' },
      { label: 'Done', count: '10' },
    ])

    // 5 To Do + 10 Done = 15 data rows on page 2.
    const rows = dataRows()
    expect(rows.length).toBe(15)

    // A "To Do" row from the first-page group (TP-26) is present on page 2 —
    // rows aren't split away from their group by the page boundary.
    expect(screen.getByText('TP-26')).toBeInTheDocument()
    expect(screen.getByText('DN-1')).toBeInTheDocument()
  })

  it('leaves flat (ungrouped) pagination unchanged', () => {
    renderPage()

    // No group-by: 25 flat rows, no group headers, full total in the pager.
    expect(groupHeaders()).toEqual([])
    expect(dataRows().length).toBe(25)
    expect(within(document.querySelector('.jira-list-pagination')).getByText('1–25 of 40')).toBeInTheDocument()
  })
})
