// JL-190 — Backlog bulk toolbar: shared selection, field/value controls driven
// by the project's config, one bulk request per Apply, and per-issue outcomes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  BACKLOG_VALUE, UNASSIGNED_VALUE, bulkOperation, sectionState, setSection, summarizeBulkResult, toggleId,
} from '../utils/bulkSelection'

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ loaded: true, canCreateIssue: true, canEditIssue: true, canDeleteIssue: true, canManageSprints: true }),
}))
vi.mock('../api/dependencyApi', () => ({
  fetchProjectDependencies: vi.fn().mockResolvedValue({ issues: [], edges: [], cycles: [], summary: {} }),
}))
vi.mock('../api/watcherApi', () => ({
  fetchWatchers: vi.fn().mockResolvedValue([]),
  watchIssue: vi.fn().mockResolvedValue({ watching: true }),
  unwatchIssue: vi.fn().mockResolvedValue({ watching: false }),
}))
vi.mock('../api/issueConfigApi', () => ({
  fetchProjectStatuses: vi.fn().mockResolvedValue([{ name: 'Backlog' }, { name: 'Triage' }, { name: 'Done' }]),
  fetchProjectPriorities: vi.fn().mockResolvedValue([{ name: 'Low' }, { name: 'Urgent' }]),
}))
vi.mock('../api/labelApi', () => ({
  fetchProjectLabels: vi.fn().mockResolvedValue([{ name: 'frontend' }]),
}))
vi.mock('../api/issueApi', async (importOriginal) => ({
  ...(await importOriginal()),
  bulkChangeIssues: vi.fn(),
}))

const reloadIssues = vi.fn().mockResolvedValue(undefined)
let mockIssues = []

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: mockIssues, handleMove: vi.fn(), handleUpdate: vi.fn(), handleDelete: vi.fn(), handleCreate: vi.fn(), reloadIssues,
  }),
}))
vi.mock('../context/SprintContext', () => {
  const sprints = [
    { id: 10, name: 'Sprint 1', dateRange: 'Jul 1 - Jul 14', isStarted: false, completedAt: null },
    { id: 11, name: 'Old sprint', dateRange: 'Jun', isStarted: false, completedAt: '2026-06-30' },
  ]
  return {
    useSprints: () => ({
      sprints, handleCreateSprint: vi.fn(), handleStartSprint: vi.fn(), handleUpdateSprint: vi.fn(), handleDeleteSprint: vi.fn(),
    }),
  }
})
vi.mock('../context/MemberContext', () => {
  const members = [{ id: 1, name: 'Alice Anderson', email: 'alice@example.com' }]
  return {
    useMembers: () => ({
      profile: { full_name: 'Alice Anderson' }, members,
      currentMember: { workspaceRole: 'Member', isOwner: false, projectRoles: [] },
    }),
  }
})

import { bulkChangeIssues } from '../api/issueApi'
import { BacklogPage } from '../pages/BacklogPage/BacklogPage'

function issue(overrides) {
  return {
    id: 0, key: 'TP-0', title: 'Issue', status: 'Backlog', priority: 'Medium', issueType: 'Task', assignee: '',
    sprintId: null, projectId: 1, storyPoints: null, createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z',
    ...overrides,
  }
}

describe('bulkSelection helpers', () => {
  it('toggles single ids and whole sections without touching other sections', () => {
    expect(toggleId([1, 2], 2)).toEqual([1])
    expect(toggleId([1], 2)).toEqual([1, 2])
    expect(setSection([1, 9], [2, 3], true)).toEqual([1, 9, 2, 3])
    expect(setSection([1, 2, 3, 9], [2, 3], false)).toEqual([1, 9])
  })

  it('reports none / some / all for a section, and none for an empty one', () => {
    expect(sectionState([], [1, 2])).toBe('none')
    expect(sectionState([1], [1, 2])).toBe('some')
    expect(sectionState([2, 1, 7], [1, 2])).toBe('all')
    expect(sectionState([1], [])).toBe('none')
  })

  it('maps toolbar choices to bulk operations, including the Unassigned and Backlog sentinels', () => {
    expect(bulkOperation('assignee', UNASSIGNED_VALUE)).toEqual({ assignee: null })
    expect(bulkOperation('sprint', BACKLOG_VALUE)).toEqual({ sprintId: null })
    expect(bulkOperation('sprint', '10')).toEqual({ sprintId: 10 })
    expect(bulkOperation('labels', 'frontend')).toEqual({ addLabels: ['frontend'] })
    expect(bulkOperation('delete')).toEqual({ delete: true })
    expect(bulkOperation('nope', 'x')).toBeNull()
  })

  it('summarises full success, no-ops, partial and total failure', () => {
    const ok = (id) => ({ issueId: id, key: `TP-${id}`, applied: true })
    const bad = (id, error) => ({ issueId: id, key: `TP-${id}`, applied: false, error })
    expect(summarizeBulkResult({ results: [ok(1), ok(2), ok(3)] })).toMatchObject({ severity: 'success', message: '3 work items updated', failedIds: [] })
    expect(summarizeBulkResult({ results: [ok(1), { issueId: 2, applied: false, error: null, noop: true }] }).message)
      .toBe('1 work item updated (1 already up to date)')
    expect(summarizeBulkResult({ results: [{ issueId: 1, applied: false, error: null, noop: true }] }).severity).toBe('info')
    expect(summarizeBulkResult({ results: [ok(1), ok(2), bad(8, 'invalid transition')] }))
      .toMatchObject({ severity: 'warning', message: '2 updated, 1 failed (TP-8: invalid transition)', failedIds: [8] })
    const allBad = summarizeBulkResult({ results: [1, 2, 3, 4].map((id) => bad(id, 'nope')) })
    expect(allBad.severity).toBe('error')
    expect(allBad.message).toMatch(/^4 failed \(TP-1: nope; TP-2: nope; TP-3: nope; \+1 more\)$/)
  })
})

describe('BacklogPage bulk toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reloadIssues.mockResolvedValue(undefined)
    mockIssues = [
      issue({ id: 1, key: 'TP-1', title: 'First' }),
      issue({ id: 2, key: 'TP-2', title: 'Second' }),
      issue({ id: 3, key: 'TP-3', title: 'Third', status: 'To Do', sprintId: 10 }),
    ]
  })

  const renderBacklog = () => render(<MemoryRouter><BacklogPage /></MemoryRouter>)
  const field = () => screen.getByLabelText('Bulk action')
  const apply = () => screen.getByRole('button', { name: 'Apply' })
  const select = (key) => fireEvent.click(screen.getByLabelText(`Select ${key}`))

  it('is disabled with nothing selected and enables as soon as one item is', () => {
    renderBacklog()
    expect(screen.getByText('0 selected')).toBeInTheDocument()
    expect(field()).toBeDisabled()
    expect(apply()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Advanced bulk change' })).toBeDisabled()

    select('TP-1')
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(field()).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Advanced bulk change' })).toBeEnabled()
    // No field chosen yet → still nothing to apply.
    expect(apply()).toBeDisabled()

    select('TP-1')
    expect(field()).toBeDisabled()
  })

  it('section checkbox selects all, shows indeterminate when partial, and the count spans sections', () => {
    renderBacklog()
    const backlogAll = screen.getByLabelText('Select all backlog issues')
    select('TP-1')
    expect(backlogAll).toHaveAttribute('aria-checked', 'mixed')
    expect(backlogAll.indeterminate).toBe(true)

    fireEvent.click(backlogAll)
    expect(backlogAll).toBeChecked()
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Select all Sprint 1 issues'))
    expect(screen.getByText('3 selected')).toBeInTheDocument()

    fireEvent.click(backlogAll)
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('loads status values from the project config and resets the value when the field changes', async () => {
    renderBacklog()
    select('TP-1')
    fireEvent.change(field(), { target: { value: 'status' } })
    const statusValue = screen.getByLabelText('Status value')
    await waitFor(() => expect(within(statusValue).getByRole('option', { name: 'Triage' })).toBeInTheDocument())
    expect(within(statusValue).queryByRole('option', { name: 'Code Review' })).toBeNull()

    fireEvent.change(statusValue, { target: { value: 'Triage' } })
    expect(apply()).toBeEnabled()

    fireEvent.change(field(), { target: { value: 'priority' } })
    expect(screen.getByLabelText('Priority value')).toHaveValue('')
    expect(apply()).toBeDisabled()
  })

  it('offers Unassigned, Backlog + only unfinished sprints, and no Sub-task type', () => {
    renderBacklog()
    select('TP-1')
    fireEvent.change(field(), { target: { value: 'assignee' } })
    expect(within(screen.getByLabelText('Assignee value')).getByRole('option', { name: 'Unassigned' })).toBeInTheDocument()

    fireEvent.change(field(), { target: { value: 'sprint' } })
    const sprintValue = screen.getByLabelText('Sprint value')
    expect(within(sprintValue).getByRole('option', { name: 'Backlog' })).toBeInTheDocument()
    expect(within(sprintValue).getByRole('option', { name: 'Sprint 1' })).toBeInTheDocument()
    expect(within(sprintValue).queryByRole('option', { name: 'Old sprint' })).toBeNull()

    fireEvent.change(field(), { target: { value: 'issueType' } })
    expect(within(screen.getByLabelText('Issue type value')).queryByRole('option', { name: 'Sub-task' })).toBeNull()
  })

  it('Apply sends ONE bulk request, reloads in place, toasts, and clears the selection', async () => {
    bulkChangeIssues.mockResolvedValue({
      updated: 2, skipped: 0, errors: [],
      results: [{ issueId: 1, key: 'TP-1', applied: true }, { issueId: 3, key: 'TP-3', applied: true }],
    })
    renderBacklog()
    select('TP-1')
    fireEvent.click(screen.getByLabelText('Select all Sprint 1 issues'))
    fireEvent.change(field(), { target: { value: 'assignee' } })
    fireEvent.change(screen.getByLabelText('Assignee value'), { target: { value: UNASSIGNED_VALUE } })
    fireEvent.click(apply())

    expect(await screen.findByText('2 work items updated')).toBeInTheDocument()
    expect(bulkChangeIssues).toHaveBeenCalledTimes(1)
    expect(bulkChangeIssues).toHaveBeenCalledWith({ issueIds: [1, 3], operations: { assignee: null } })
    expect(reloadIssues).toHaveBeenCalled()
    expect(screen.getByText('0 selected')).toBeInTheDocument()
  })

  it('a partial failure names the key and reason and keeps the failed item selected', async () => {
    bulkChangeIssues.mockResolvedValue({
      updated: 1, skipped: 1,
      errors: [{ issueId: 2, error: 'Transition from "Backlog" to "Done" is not allowed by the workflow' }],
      results: [
        { issueId: 1, key: 'TP-1', applied: true },
        { issueId: 2, key: 'TP-2', applied: false, error: 'Transition from "Backlog" to "Done" is not allowed by the workflow' },
      ],
    })
    renderBacklog()
    fireEvent.click(screen.getByLabelText('Select all backlog issues'))
    fireEvent.change(field(), { target: { value: 'status' } })
    await waitFor(() => expect(within(screen.getByLabelText('Status value')).getByRole('option', { name: 'Done' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Status value'), { target: { value: 'Done' } })
    fireEvent.click(apply())

    expect(await screen.findByText(/^1 updated, 1 failed \(TP-2: Transition from "Backlog" to "Done"/)).toBeInTheDocument()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByLabelText('Select TP-2')).toBeChecked()
  })

  it('a request error is reported and the selection is kept for a retry', async () => {
    bulkChangeIssues.mockRejectedValue(new Error('Network down'))
    renderBacklog()
    select('TP-1')
    fireEvent.change(field(), { target: { value: 'issueType' } })
    fireEvent.change(screen.getByLabelText('Issue type value'), { target: { value: 'Bug' } })
    fireEvent.click(apply())

    expect(await screen.findByText('Network down')).toBeInTheDocument()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('Esc clears the selection', () => {
    renderBacklog()
    select('TP-1')
    select('TP-2')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByText('0 selected')).toBeInTheDocument()
  })

  it('changing the search or a quick filter clears the selection', () => {
    renderBacklog()
    select('TP-1')
    fireEvent.change(screen.getByPlaceholderText('Search backlog...'), { target: { value: 'First' } })
    expect(screen.getByText('0 selected')).toBeInTheDocument()

    select('TP-1')
    fireEvent.click(screen.getByText('My open issues'))
    expect(screen.getByText('0 selected')).toBeInTheDocument()
  })
})
