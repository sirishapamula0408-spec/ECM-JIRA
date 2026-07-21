// JL-274 / JL-268 / JL-273 — Workflow Editor canvas is now real (project-scoped).
//  - JL-274: canvas nodes come from fetchProjectStatuses; Add Status/Transition and
//    node/arrow deletes call the real API clients; both canvas + rules panel share data.
//  - JL-268: the dead "Publish" button is gone; header exposes "Reset layout".
//  - JL-273: modals are MUI dialogs (role=dialog, close on Escape); zoom buttons labelled.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// ── Permission mock (mutated per test) ──
let mockIsAdmin = true
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: mockIsAdmin }),
}))

// ── API mocks ──
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn(),
}))
vi.mock('../api/issueConfigApi', () => ({
  fetchProjectStatuses: vi.fn(),
  createStatus: vi.fn(),
  deleteStatus: vi.fn(),
}))
vi.mock('../api/workflowTransitionApi', () => ({
  fetchWorkflowTransitions: vi.fn(),
  createWorkflowTransition: vi.fn(),
  updateWorkflowTransition: vi.fn(),
  deleteWorkflowTransition: vi.fn(),
}))

import { fetchProjects } from '../api/projectApi'
import { fetchProjectStatuses, createStatus, deleteStatus } from '../api/issueConfigApi'
import {
  fetchWorkflowTransitions,
  createWorkflowTransition,
  deleteWorkflowTransition,
} from '../api/workflowTransitionApi'
import { WorkflowEditorPage } from '../pages/WorkflowEditorPage/WorkflowEditorPage'

const STATUSES = [
  { id: 10, project_id: 1, name: 'To Do', category: 'todo', color: '#DEEBFF' },
  { id: 11, project_id: 1, name: 'In Progress', category: 'inprogress', color: '#FFF0B3' },
  { id: 12, project_id: 1, name: 'Done', category: 'done', color: '#E3FCEF' },
]

const TRANSITIONS = [
  { id: 5, fromStatus: 'To Do', toStatus: 'In Progress', validators: [], postFunctions: [] },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAdmin = true
  localStorage.clear()
  fetchProjects.mockResolvedValue([{ id: 1, name: 'Test Project' }])
  fetchProjectStatuses.mockResolvedValue(STATUSES)
  fetchWorkflowTransitions.mockResolvedValue(TRANSITIONS)
  createStatus.mockResolvedValue({ id: 99, project_id: 1, name: 'QA', category: 'todo', color: '#42526E' })
  deleteStatus.mockResolvedValue({ success: true })
  createWorkflowTransition.mockResolvedValue({ id: 6 })
  deleteWorkflowTransition.mockResolvedValue({ success: true })
})

describe('JL-274 — canvas renders real project statuses', () => {
  it('renders a node for each status from fetchProjectStatuses', async () => {
    render(<WorkflowEditorPage />)
    // node names appear on the canvas (as role=button nodes)
    expect(await screen.findByRole('button', { name: /Status To Do/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Status In Progress/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Status Done/ })).toBeInTheDocument()
    expect(fetchProjectStatuses).toHaveBeenCalledWith('1')
    expect(fetchWorkflowTransitions).toHaveBeenCalledWith('1')
  })
})

describe('JL-274 — Add Status / Add Transition hit the API', () => {
  it('Add Status calls createStatus and refetches', async () => {
    render(<WorkflowEditorPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Add status/ }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Status name'), { target: { value: 'QA Testing' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(createStatus).toHaveBeenCalledTimes(1))
    expect(createStatus).toHaveBeenCalledWith('1', expect.objectContaining({ name: 'QA Testing', category: 'todo' }))
    // refetch after mutation (initial load + reload)
    await waitFor(() => expect(fetchProjectStatuses).toHaveBeenCalledTimes(2))
  })

  it('Add Transition calls createWorkflowTransition', async () => {
    render(<WorkflowEditorPage />)
    // Wait for statuses to load so the toolbar button is enabled (needs >= 2 statuses).
    await screen.findByRole('button', { name: /Status To Do/ })
    // Two "Add transition" buttons exist (toolbar + rules panel); click the toolbar one.
    const addTransButtons = screen.getAllByRole('button', { name: 'Add transition' })
    fireEvent.click(addTransButtons[0])

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('From status'), { target: { value: 'In Progress' } })
    fireEvent.change(within(dialog).getByLabelText('To status'), { target: { value: 'Done' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(createWorkflowTransition).toHaveBeenCalledTimes(1))
    expect(createWorkflowTransition).toHaveBeenCalledWith('1', { fromStatus: 'In Progress', toStatus: 'Done' })
  })
})

describe('JL-274 — deleting a node/arrow calls the API after confirm', () => {
  it('deletes a status via deleteStatus after confirming', async () => {
    render(<WorkflowEditorPage />)
    const node = await screen.findByRole('button', { name: /Status To Do/ })
    fireEvent.click(node)

    // properties panel shows delete
    fireEvent.click(await screen.findByRole('button', { name: /Delete status/ }))

    // confirm dialog appears
    const confirmDlg = await screen.findByRole('dialog')
    fireEvent.click(within(confirmDlg).getByRole('button', { name: /Delete status/ }))

    await waitFor(() => expect(deleteStatus).toHaveBeenCalledWith(10))
  })

  it('deletes a transition via deleteWorkflowTransition after confirming', async () => {
    render(<WorkflowEditorPage />)
    // select the transition from the properties selectable list
    fireEvent.click(await screen.findByRole('button', { name: 'To Do → In Progress' }))

    fireEvent.click(await screen.findByRole('button', { name: /Delete transition/ }))
    const confirmDlg = await screen.findByRole('dialog')
    fireEvent.click(within(confirmDlg).getByRole('button', { name: /Delete transition/ }))

    await waitFor(() => expect(deleteWorkflowTransition).toHaveBeenCalledWith(5))
  })
})

describe('JL-273 — modal accessibility', () => {
  it('Add Status dialog closes on Escape', async () => {
    render(<WorkflowEditorPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Add status/ }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('zoom buttons have accessible labels', async () => {
    render(<WorkflowEditorPage />)
    expect(await screen.findByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
  })
})

describe('JL-268 — no dead Publish button', () => {
  it('has no Publish button and exposes Reset layout instead', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset layout' })).toBeInTheDocument()
  })
})
