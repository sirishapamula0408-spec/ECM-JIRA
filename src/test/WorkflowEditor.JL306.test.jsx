// JL-306 — WorkflowEditor renders the QA Lifecycle states/transitions and lets an
// admin add a state + a transition (and apply the QA template) with the api mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: true }),
}))

vi.mock('../api/projectApi', () => ({ fetchProjects: vi.fn() }))
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
vi.mock('../api/workflowDefinitionApi', () => ({
  fetchWorkflowDefinitions: vi.fn(),
  applyWorkflowTemplate: vi.fn(),
  createWorkflowDefinition: vi.fn(),
}))

import { fetchProjects } from '../api/projectApi'
import { fetchProjectStatuses, createStatus } from '../api/issueConfigApi'
import { fetchWorkflowTransitions, createWorkflowTransition } from '../api/workflowTransitionApi'
import { fetchWorkflowDefinitions, applyWorkflowTemplate, createWorkflowDefinition } from '../api/workflowDefinitionApi'
import { WorkflowEditorPage } from '../pages/WorkflowEditorPage/WorkflowEditorPage'

// The 8 QA lifecycle states.
const QA_STATUSES = [
  { id: 1, project_id: 1, name: 'Backlog', category: 'todo', color: '#42526E' },
  { id: 2, project_id: 1, name: 'To Do', category: 'todo', color: '#42526E' },
  { id: 3, project_id: 1, name: 'In Progress', category: 'inprogress', color: '#0052CC' },
  { id: 4, project_id: 1, name: 'In Testing', category: 'inprogress', color: '#FF8B00' },
  { id: 5, project_id: 1, name: 'In Rework', category: 'inprogress', color: '#FF7452' },
  { id: 6, project_id: 1, name: 'In UAT', category: 'inprogress', color: '#6554C0' },
  { id: 7, project_id: 1, name: 'Done', category: 'done', color: '#36B37E' },
  { id: 8, project_id: 1, name: 'Cancelled', category: 'done', color: '#97A0AF' },
]

const QA_TRANSITIONS = [
  { id: 101, fromStatus: 'Backlog', toStatus: 'To Do', validators: [], postFunctions: [] },
  { id: 102, fromStatus: 'To Do', toStatus: 'In Progress', validators: [], postFunctions: [] },
  { id: 103, fromStatus: 'In Progress', toStatus: 'In Testing', validators: [], postFunctions: [] },
  { id: 104, fromStatus: 'In Testing', toStatus: 'In UAT', validators: [], postFunctions: [] },
  { id: 105, fromStatus: 'In Testing', toStatus: 'In Rework', validators: [], postFunctions: [] },
  { id: 106, fromStatus: 'In Rework', toStatus: 'In Progress', validators: [], postFunctions: [] },
  { id: 107, fromStatus: 'In UAT', toStatus: 'Done', validators: [], postFunctions: [] },
  { id: 108, fromStatus: 'In UAT', toStatus: 'In Rework', validators: [], postFunctions: [] },
]

const QA_DEFAULT_WORKFLOW = {
  id: 1, projectId: 1, name: 'QA Lifecycle', initialStatus: 'Backlog',
  terminalStatuses: ['Done', 'Cancelled'], cancelFromAny: true, cancelStatus: 'Cancelled', isDefault: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  fetchProjects.mockResolvedValue([{ id: 1, name: 'QA Project' }])
  fetchProjectStatuses.mockResolvedValue(QA_STATUSES)
  fetchWorkflowTransitions.mockResolvedValue(QA_TRANSITIONS)
  fetchWorkflowDefinitions.mockResolvedValue([QA_DEFAULT_WORKFLOW])
  createStatus.mockResolvedValue({ id: 9 })
  createWorkflowTransition.mockResolvedValue({ id: 200 })
  applyWorkflowTemplate.mockResolvedValue(QA_DEFAULT_WORKFLOW)
  createWorkflowDefinition.mockResolvedValue({ id: 2, name: 'QA Lifecycle', isDefault: true })
})

describe('JL-306 — QA Lifecycle in the Workflow Editor', () => {
  it('renders the QA lifecycle states and transitions + the default-workflow badge', async () => {
    render(<WorkflowEditorPage />)

    // All eight QA states render as nodes.
    for (const name of ['Backlog', 'In Testing', 'In Rework', 'In UAT', 'Cancelled']) {
      expect(await screen.findByRole('button', { name: new RegExp(`Status ${name}`) })).toBeInTheDocument()
    }

    // A QA branch transition renders (In Testing → In UAT appears in the diagram/list).
    await waitFor(() =>
      expect(screen.getAllByText(/In Testing\s*→\s*In UAT/).length).toBeGreaterThan(0),
    )

    // The applied default workflow is surfaced.
    const badge = await screen.findByTestId('wfe-default-workflow')
    expect(badge).toHaveTextContent(/QA Lifecycle/)
    expect(badge).toHaveTextContent(/cancel from any/i)
  })

  it('adds a new state via the Add status dialog (api mocked)', async () => {
    render(<WorkflowEditorPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Add status/ }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Status name'), { target: { value: 'In Staging' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add$/ }))

    await waitFor(() => expect(createStatus).toHaveBeenCalledTimes(1))
    expect(createStatus).toHaveBeenCalledWith('1', expect.objectContaining({ name: 'In Staging' }))
  })

  it('adds a new transition via the Add transition dialog (api mocked)', async () => {
    render(<WorkflowEditorPage />)
    // Wait for statuses to load (the toolbar "Add transition" button is disabled
    // until there are >= 2 statuses).
    await screen.findByRole('button', { name: /Status Backlog/ })
    // Two controls are named "Add transition" (toolbar + rules panel); the toolbar
    // button — first in DOM order — is the one that opens the modal dialog.
    const addTransBtns = screen.getAllByRole('button', { name: 'Add transition' })
    fireEvent.click(addTransBtns[0])

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('From status'), { target: { value: 'Backlog' } })
    fireEvent.change(within(dialog).getByLabelText('To status'), { target: { value: 'In Progress' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add$/ }))

    await waitFor(() => expect(createWorkflowTransition).toHaveBeenCalledTimes(1))
    expect(createWorkflowTransition).toHaveBeenCalledWith('1', { fromStatus: 'Backlog', toStatus: 'In Progress' })
  })

  it('applies the QA Lifecycle template from the toolbar (api mocked)', async () => {
    render(<WorkflowEditorPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Apply QA Lifecycle template/ }))

    // Confirm the action in the dialog.
    const confirmBtn = await screen.findByRole('button', { name: /Apply workflow/ })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(applyWorkflowTemplate).toHaveBeenCalledTimes(1))
    expect(applyWorkflowTemplate).toHaveBeenCalledWith('1', 'qa-lifecycle')
  })
})

// ── JL-306 fix: the Publish control was previously unwired (no-op). It must now
// persist the customised canvas as a named custom workflow set as project default. ──
describe('JL-306 — Publish persists a custom named workflow (regression)', () => {
  it('clicking Publish workflow → Publish calls createWorkflowDefinition with the current graph as default', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status Backlog/ })

    fireEvent.click(screen.getByRole('button', { name: 'Publish workflow' }))
    const dialog = await screen.findByRole('dialog')

    // Name is prefilled from the current default workflow; confirm publish.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(createWorkflowDefinition).toHaveBeenCalledTimes(1))
    const [pid, body] = createWorkflowDefinition.mock.calls[0]
    expect(pid).toBe('1')
    expect(body.isDefault).toBe(true)
    expect(body.states.map((s) => s.name)).toEqual(QA_STATUSES.map((s) => s.name))
    expect(body.transitions).toEqual(
      QA_TRANSITIONS.map((t) => ({ fromStatus: t.fromStatus, toStatus: t.toStatus })),
    )
    // Done + Cancelled are the 'done'-category terminal states.
    expect(body.terminalStatuses).toEqual(['Done', 'Cancelled'])
    // Reloads the workflow definitions after publishing.
    await waitFor(() => expect(fetchWorkflowDefinitions).toHaveBeenCalledTimes(2))
  })

  it('lets the admin rename the workflow before publishing', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status Backlog/ })
    fireEvent.click(screen.getByRole('button', { name: 'Publish workflow' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Workflow name'), { target: { value: 'Release Flow' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(createWorkflowDefinition).toHaveBeenCalledTimes(1))
    expect(createWorkflowDefinition.mock.calls[0][1].name).toBe('Release Flow')
  })
})

// ── JL-306: disabled-button UX hardening ──
describe('JL-306 — disabled toolbar buttons explain why / project-load hints', () => {
  it('when no project is selected, Add status & Publish are disabled with explanatory titles', async () => {
    fetchProjects.mockResolvedValue([]) // no projects → projectId stays empty
    render(<WorkflowEditorPage />)
    const addStatus = await screen.findByRole('button', { name: 'Add status' })
    expect(addStatus).toBeDisabled()
    expect(addStatus).toHaveAttribute('title', 'Select a project first')

    const publish = screen.getByRole('button', { name: 'Publish workflow' })
    expect(publish).toBeDisabled()
    expect(publish).toHaveAttribute('title', 'Select a project first')
  })

  it('shows a "server running?" hint when fetchProjects rejects', async () => {
    fetchProjects.mockRejectedValue(new Error('network down'))
    render(<WorkflowEditorPage />)
    expect(await screen.findByText(/Couldn.t load projects/i)).toBeInTheDocument()
  })

  it('shows a "No projects yet" hint when the project list is empty', async () => {
    fetchProjects.mockResolvedValue([])
    render(<WorkflowEditorPage />)
    expect(await screen.findByText(/No projects yet/i)).toBeInTheDocument()
  })
})
