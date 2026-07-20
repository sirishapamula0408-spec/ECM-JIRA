// JL-256 — List view sortable column headers.
// Clicking a sortable header sorts rows asc, then desc, then clears; aria-sort on
// the <th> reflects the state; and sort composes with the status filter.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const ISSUES = [
  { id: 1, key: 'TP-1', title: 'Banana', status: 'To Do', priority: 'Low', issueType: 'Task', assignee: 'Bob', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Apple', status: 'To Do', priority: 'High', issueType: 'Bug', assignee: 'Al', sprintId: null, projectId: 1 },
  { id: 3, key: 'TP-3', title: 'Cherry', status: 'Done', priority: 'Medium', issueType: 'Story', assignee: 'Cy', sprintId: null, projectId: 1 },
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

// Displayed summary text in row order.
function summaryOrder() {
  return Array.from(document.querySelectorAll('.jira-list-summary-link')).map((e) => e.textContent)
}

function summaryHeader() {
  return screen.getByRole('columnheader', { name: /Summary/i })
}

function clickSummary() {
  fireEvent.click(screen.getByRole('button', { name: /Summary/i }))
}

describe('JL-256 — List view column sorting', () => {
  beforeEach(() => vi.clearAllMocks())

  it('toggles a header asc -> desc -> cleared and updates aria-sort each time', () => {
    renderPage()

    // Unsorted: original data order.
    expect(summaryOrder()).toEqual(['Banana', 'Apple', 'Cherry'])
    expect(summaryHeader()).toHaveAttribute('aria-sort', 'none')

    // 1st click => ascending.
    clickSummary()
    expect(summaryOrder()).toEqual(['Apple', 'Banana', 'Cherry'])
    expect(summaryHeader()).toHaveAttribute('aria-sort', 'ascending')

    // 2nd click => descending.
    clickSummary()
    expect(summaryOrder()).toEqual(['Cherry', 'Banana', 'Apple'])
    expect(summaryHeader()).toHaveAttribute('aria-sort', 'descending')

    // 3rd click => cleared, back to original order + aria-sort none.
    clickSummary()
    expect(summaryOrder()).toEqual(['Banana', 'Apple', 'Cherry'])
    expect(summaryHeader()).toHaveAttribute('aria-sort', 'none')
  })

  it('only the active column reports a non-none aria-sort', () => {
    renderPage()
    clickSummary()

    expect(summaryHeader()).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: /Key/i })).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByRole('columnheader', { name: /Status/i })).toHaveAttribute('aria-sort', 'none')
  })

  it('composes with the status filter (sort applies within the filtered set)', () => {
    renderPage()

    // Filter to To Do => only Banana + Apple remain.
    fireEvent.change(screen.getByDisplayValue('Filter'), { target: { value: 'To Do' } })
    expect(summaryOrder()).toEqual(['Banana', 'Apple'])

    // Sort ascending => Apple before Banana, Cherry (Done) still filtered out.
    clickSummary()
    expect(summaryOrder()).toEqual(['Apple', 'Banana'])
    expect(screen.queryByText('Cherry')).not.toBeInTheDocument()
  })
})
