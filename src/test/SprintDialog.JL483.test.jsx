// JL-483: Jira-style Create / Edit / Delete sprint on the Backlog, for the
// people who may manage sprints (project Lead/Admin, workspace Admin/Owner).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { addDays, inferDuration, endForDuration, toDay } from '../utils/sprintDates'

let mockPerms
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => mockPerms }))

const handleCreateSprint = vi.fn()
const handleUpdateSprint = vi.fn()
const handleDeleteSprint = vi.fn()
let mockSprints
vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({
    sprints: mockSprints,
    handleCreateSprint,
    handleStartSprint: vi.fn(),
    handleUpdateSprint,
    handleDeleteSprint,
  }),
}))
const ISSUES = [
  { id: 1, key: 'TP-1', title: 'Backlog story', status: 'Backlog', priority: 'Medium', issueType: 'Story', assignee: 'Alice', sprintId: null, projectId: 1 },
  { id: 2, key: 'TP-2', title: 'Sprint task', status: 'To Do', priority: 'High', issueType: 'Task', assignee: 'Bob', sprintId: 10, projectId: 1 },
  { id: 3, key: 'TP-3', title: 'Another', status: 'In Progress', priority: 'High', issueType: 'Task', assignee: 'Bob', sprintId: 10, projectId: 1 },
]
vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: ISSUES, handleMove: vi.fn(), handleCreate: vi.fn(), reloadIssues: vi.fn() }),
}))
vi.mock('../context/MemberContext', () => ({ useMembers: () => ({ profile: { full_name: 'Lee' }, members: [] }) }))
vi.mock('../api/issueConfigApi', () => ({ fetchProjectStatuses: vi.fn(async () => []), fetchProjectPriorities: vi.fn(async () => []) }))
vi.mock('../api/labelApi', () => ({ fetchProjectLabels: vi.fn(async () => []) }))
vi.mock('../api/dependencyApi', () => ({ fetchProjectDependencies: vi.fn(async () => ({ byId: {}, edges: [], cycles: [], blockedCount: 0 })) }))
vi.mock('../api/issueApi', () => ({ bulkChangeIssues: vi.fn() }))
vi.mock('../api/watcherApi', () => ({ watchIssue: vi.fn(), unwatchIssue: vi.fn() }))

import { BacklogPage } from '../pages/BacklogPage/BacklogPage'

const LEAD = { loaded: true, isAdmin: false, canCreateIssue: true, canEditIssue: true, canDeleteIssue: false, canManageSprints: true, canExportIssues: true }
const MEMBER = { ...LEAD, canManageSprints: false }

function renderBacklog() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/backlog']}>
      <Routes><Route path="/projects/:projectId/backlog" element={<BacklogPage />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPerms = { ...LEAD }
  mockSprints = [{ id: 10, projectId: 1, name: 'TP Sprint 1', dateRange: '19 Jan - 2 Feb', isStarted: false, startDate: '2026-01-19T00:00:00.000Z', endDate: '2026-02-02T00:00:00.000Z', goal: 'Ship login' }]
})

describe('date helpers', () => {
  it('derive end dates from a duration and recognise durations back', () => {
    expect(addDays('2026-01-19', 14)).toBe('2026-02-02')
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08')
    expect(endForDuration('2026-01-19', '1')).toBe('2026-01-26')
    expect(endForDuration('2026-01-19', 'custom')).toBe('')
    expect(inferDuration('2026-01-19', '2026-02-02')).toBe('2')
    expect(inferDuration('2026-01-19', '2026-01-30')).toBe('custom')
    expect(toDay('2026-01-19T00:00:00.000Z')).toBe('2026-01-19')
  })
})

describe('Create sprint', () => {
  it('opens a Jira-style dialog prefilled with "KEY Sprint N", 2 weeks from today', () => {
    renderBacklog()
    fireEvent.click(screen.getByRole('button', { name: 'Create sprint' }))
    const dialog = screen.getByRole('dialog', { name: 'Create sprint' })
    expect(within(dialog).getByLabelText('Sprint name')).toHaveValue('TP Sprint 2')
    const start = within(dialog).getByLabelText('Start date').value
    expect(within(dialog).getByLabelText('End date')).toHaveValue(addDays(start, 14))
    expect(within(dialog).getByLabelText('End date')).toBeDisabled() // set by the duration
    expect(within(dialog).getByLabelText('Sprint goal')).toHaveValue('')
  })

  it('creates the sprint with the chosen name, dates and goal', async () => {
    handleCreateSprint.mockResolvedValue({ id: 11, name: 'TP Sprint 2' })
    renderBacklog()
    fireEvent.click(screen.getByRole('button', { name: 'Create sprint' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-03-02' } })
    fireEvent.change(within(dialog).getByLabelText('Sprint goal'), { target: { value: 'Payments MVP' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(handleCreateSprint).toHaveBeenCalledWith({
      projectId: 1, name: 'TP Sprint 2', startDate: '2026-03-02', endDate: '2026-03-16', goal: 'Payments MVP',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Custom duration lets the end date be edited, and refuses an end before the start', () => {
    renderBacklog()
    fireEvent.click(screen.getByRole('button', { name: 'Create sprint' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.mouseDown(within(dialog).getByLabelText('Duration'))
    fireEvent.click(screen.getByRole('option', { name: 'Custom' }))
    const end = within(dialog).getByLabelText('End date')
    expect(end).toBeEnabled()
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-03-10' } })
    fireEvent.change(end, { target: { value: '2026-03-01' } })
    expect(within(dialog).getByText('The end date must be on or after the start date')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('keeps the dialog open and shows the server error if creating fails', async () => {
    handleCreateSprint.mockRejectedValue(new Error('Insufficient project permissions'))
    renderBacklog()
    fireEvent.click(screen.getByRole('button', { name: 'Create sprint' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Insufficient project permissions')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('Edit sprint', () => {
  it('replaces Rename: opens the dialog prefilled from the sprint and saves name, dates and goal', async () => {
    handleUpdateSprint.mockResolvedValue({})
    renderBacklog()
    expect(screen.getByText('Ship login')).toBeInTheDocument() // goal shown on the sprint row
    fireEvent.click(screen.getByLabelText('Sprint actions'))
    expect(screen.queryByText('Rename sprint')).toBeNull()
    fireEvent.click(screen.getByText('Edit sprint'))

    const dialog = screen.getByRole('dialog', { name: 'Edit sprint: TP Sprint 1' })
    expect(within(dialog).getByLabelText(/Sprint name/)).toHaveValue('TP Sprint 1')
    expect(within(dialog).getByLabelText('Start date')).toHaveValue('2026-01-19')
    expect(within(dialog).getByLabelText('End date')).toHaveValue('2026-02-02')
    expect(within(dialog).getByLabelText('Sprint goal')).toHaveValue('Ship login')

    fireEvent.change(within(dialog).getByLabelText(/Sprint name/), { target: { value: 'TP Sprint 1 (login)' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(handleUpdateSprint).toHaveBeenCalledWith(10, {
      name: 'TP Sprint 1 (login)', startDate: '2026-01-19', endDate: '2026-02-02', goal: 'Ship login', dateRange: '19 Jan - 2 Feb',
    }))
  })

  it('will not save an empty name', () => {
    renderBacklog()
    fireEvent.click(screen.getByLabelText('Sprint actions'))
    fireEvent.click(screen.getByText('Edit sprint'))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Sprint name/), { target: { value: '  ' } })
    expect(within(dialog).getByRole('button', { name: 'Update' })).toBeDisabled()
  })
})

describe('the sprint "…" menu', () => {
  it('renders outside the backlog panel, so overflow: hidden cannot clip "Delete sprint"', () => {
    // Regression: the old dropdown was absolutely positioned inside
    // .jira-backlog-panel (overflow: hidden); with few rows below a sprint its
    // lower items were cut off and Delete sprint could not be reached.
    const { container } = renderBacklog()
    fireEvent.click(screen.getByLabelText('Sprint actions'))
    const menu = screen.getByRole('menu')
    expect(container.querySelector('.jira-backlog-panel').contains(menu)).toBe(false)
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent))
      .toEqual(['Start sprint', 'Edit sprint', 'Move all to backlog', 'Delete sprint'])
  })

  it('closes on Escape', async () => {
    renderBacklog()
    fireEvent.click(screen.getByLabelText('Sprint actions'))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})

describe('Delete sprint', () => {
  it('says how many work items will move to the backlog, then deletes', async () => {
    handleDeleteSprint.mockResolvedValue({})
    renderBacklog()
    fireEvent.click(screen.getByLabelText('Sprint actions'))
    fireEvent.click(screen.getByText('Delete sprint'))
    expect(await screen.findByText('Its 2 work items will be moved to the backlog. Deleting the sprint cannot be undone.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete sprint' }))
    await waitFor(() => expect(handleDeleteSprint).toHaveBeenCalledWith(10))
  })
})

describe('who sees the controls', () => {
  it('a project Member sees no Create / Start / sprint menu', () => {
    mockPerms = { ...MEMBER }
    renderBacklog()
    expect(screen.queryByRole('button', { name: 'Create sprint' })).toBeNull()
    expect(screen.queryByLabelText('Sprint actions')).toBeNull()
  })

  it('a project Lead gets no controls on a shared (no-project) sprint the server would refuse', () => {
    mockSprints = [{ ...mockSprints[0], projectId: null }]
    renderBacklog()
    expect(screen.getByRole('button', { name: 'Create sprint' })).toBeInTheDocument() // can still create in this project
    expect(screen.queryByLabelText('Sprint actions')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start sprint' })).toBeNull()
  })

  it('a workspace Admin keeps the controls on a shared sprint', () => {
    mockPerms = { ...LEAD, isAdmin: true }
    mockSprints = [{ ...mockSprints[0], projectId: null }]
    renderBacklog()
    expect(screen.getByLabelText('Sprint actions')).toBeInTheDocument()
  })
})
