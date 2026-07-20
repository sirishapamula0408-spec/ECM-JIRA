// JL-257 — The List view maintains row selection (select-all + per-row
// checkboxes) but nothing consumed it. This verifies the new bulk-action
// toolbar: selecting rows reveals the bar with a live count, bulk status change
// calls the update API for the selected ids, bulk delete confirms then deletes,
// and the selection clears after every action.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const ROWS = [
  { id: 1, key: 'TP-1', title: 'First', status: 'To Do', priority: 'Medium', issueType: 'Task', assignee: 'Alice', sprintId: 7, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Second', status: 'To Do', priority: 'Low', issueType: 'Bug', assignee: 'Bob', sprintId: null, projectId: 1 },
  { id: 3, key: 'TP-3', title: 'Third', status: 'In Progress', priority: 'High', issueType: 'Story', assignee: 'Carol', sprintId: 7, projectId: 1 },
]

const handleMove = vi.fn(() => Promise.resolve())
const handleUpdate = vi.fn(() => Promise.resolve())
const handleDelete = vi.fn(() => Promise.resolve())

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: ROWS, handleCreate: vi.fn(), handleMove, handleUpdate, handleDelete }),
}))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [{ id: 7, name: 'Sprint 7' }] }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ authUser: { name: 'Alex Rivera', email: 'alex@test.com' } }) }))
vi.mock('../context/MemberContext', () => ({ useMembers: () => ({ profile: { full_name: 'Alex Rivera' } }) }))

import { WorkflowsPage } from '../pages/WorkflowsPage/WorkflowsPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkflowsPage />
    </MemoryRouter>,
  )
}

function selectRow(key) {
  fireEvent.click(screen.getByLabelText(`Select ${key}`))
}

function bulkBar() {
  return screen.queryByRole('region', { name: 'Bulk actions' })
}

describe('JL-257 — List bulk-action toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('is hidden until a row is selected, then shows the selection count', () => {
    renderPage()
    expect(bulkBar()).not.toBeInTheDocument()

    selectRow('TP-1')
    expect(bulkBar()).toBeInTheDocument()
    expect(within(bulkBar()).getByText('1 selected')).toBeInTheDocument()

    selectRow('TP-2')
    expect(within(bulkBar()).getByText('2 selected')).toBeInTheDocument()
  })

  it('bulk status change calls the update API for each selected id and clears selection', async () => {
    renderPage()
    selectRow('TP-1')
    selectRow('TP-2')

    // Action defaults to Status; pick a target status and apply.
    fireEvent.change(screen.getByLabelText('Status value'), { target: { value: 'Done' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(handleMove).toHaveBeenCalledTimes(2)
    // sprintId preserved for TP-1 (7), null for TP-2.
    expect(handleMove).toHaveBeenCalledWith(1, 'Done', 7)
    expect(handleMove).toHaveBeenCalledWith(2, 'Done', null)

    // Selection clears -> bar disappears.
    await waitFor(() => expect(bulkBar()).not.toBeInTheDocument())
    expect(screen.getByLabelText('Select TP-1').checked).toBe(false)
  })

  it('bulk delete confirms, calls delete for each id, then clears selection', async () => {
    renderPage()
    selectRow('TP-1')
    selectRow('TP-3')

    fireEvent.change(screen.getByLabelText('Bulk action'), { target: { value: 'delete' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    // Themed ConfirmDialog (JL-232) replaces window.confirm — confirm via the dialog button.
    const dialog = await screen.findByRole('dialog')
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(handleDelete).toHaveBeenCalledTimes(2)
    expect(handleDelete).toHaveBeenCalledWith(1)
    expect(handleDelete).toHaveBeenCalledWith(3)
    await waitFor(() => expect(bulkBar()).not.toBeInTheDocument())
  })

  it('cancelling the delete confirm performs no deletion and keeps the selection', async () => {
    renderPage()
    selectRow('TP-1')

    fireEvent.change(screen.getByLabelText('Bulk action'), { target: { value: 'delete' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(handleDelete).not.toHaveBeenCalled()
    // Dialog un-hides background content asynchronously on close.
    await waitFor(() => expect(within(bulkBar()).getByText('1 selected')).toBeInTheDocument())
  })

  it('reconciles selection with the active filter so hidden rows are never acted on', async () => {
    renderPage()
    // Select all three visible rows.
    fireEvent.click(screen.getByLabelText('Select all issues on this page'))
    expect(within(bulkBar()).getByText('3 selected')).toBeInTheDocument()

    // Filter to only "In Progress" -> TP-1/TP-2 (To Do) drop out of the filtered
    // set. The bar count reflects the reconciled selection (only TP-3).
    fireEvent.change(screen.getByDisplayValue('Filter'), { target: { value: 'In Progress' } })
    expect(within(bulkBar()).getByText('1 selected')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    // Only the still-visible row is acted on.
    expect(handleMove).toHaveBeenCalledTimes(1)
    expect(handleMove).toHaveBeenCalledWith(3, 'To Do', 7)
  })
})
