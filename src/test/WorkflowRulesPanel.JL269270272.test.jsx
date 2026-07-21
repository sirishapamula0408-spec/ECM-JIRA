// JL-269 / JL-270 / JL-272 — Workflow Editor "Transition Rules" panel.
//  - JL-269: admin sees Add/Edit/Remove; non-admin gets a read-only view + hint.
//  - JL-270: Edit prefills the same controls and saves via updateWorkflowTransition (PATCH).
//  - JL-272: From/To dropdowns are populated from the project's effective statuses.
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
}))
vi.mock('../api/workflowTransitionApi', () => ({
  fetchWorkflowTransitions: vi.fn(),
  createWorkflowTransition: vi.fn(),
  updateWorkflowTransition: vi.fn(),
  deleteWorkflowTransition: vi.fn(),
}))

import { fetchProjects } from '../api/projectApi'
import { fetchProjectStatuses } from '../api/issueConfigApi'
import {
  fetchWorkflowTransitions,
  updateWorkflowTransition,
} from '../api/workflowTransitionApi'
import { WorkflowEditorPage } from '../pages/WorkflowEditorPage/WorkflowEditorPage'

const SAMPLE_TRANSITION = {
  id: 5,
  fromStatus: 'To Do',
  toStatus: 'Done',
  validators: [{ type: 'required_field', field: 'assignee' }],
  postFunctions: [{ type: 'add_comment', text: 'done!' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAdmin = true
  fetchProjects.mockResolvedValue([{ id: 1, name: 'Test Project' }])
  fetchWorkflowTransitions.mockResolvedValue([SAMPLE_TRANSITION])
  fetchProjectStatuses.mockResolvedValue([
    { name: 'Backlog' },
    { name: 'QA Review' },
    { name: 'Done' },
  ])
  updateWorkflowTransition.mockResolvedValue({ id: 5 })
})

describe('JL-269 — permission gating', () => {
  it('admin sees Add transition form and Edit/Remove actions', async () => {
    render(<WorkflowEditorPage />)
    // wait for the rule row to load
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(screen.getByText('Add transition', { selector: 'strong' })).toBeInTheDocument()
    // toolbar admin controls present
    expect(screen.getByRole('button', { name: /Add status/ })).toBeInTheDocument()
  })

  it('non-admin gets a read-only view with hint, no Add/Edit/Remove', async () => {
    mockIsAdmin = false
    render(<WorkflowEditorPage />)
    // rule data still visible (read-only)
    expect(await screen.findByText('To Do')).toBeInTheDocument()
    expect(screen.getByText('Workspace Admins can configure transition rules.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByText('Add transition')).not.toBeInTheDocument()
    // toolbar Add status hidden too
    expect(screen.queryByRole('button', { name: /Add status/ })).not.toBeInTheDocument()
  })
})

describe('JL-270 — edit UI', () => {
  it('Edit prefills the controls and Save calls updateWorkflowTransition (PATCH)', async () => {
    render(<WorkflowEditorPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    // switches into edit mode with From/To shown read-only
    expect(screen.getByText('Edit transition')).toBeInTheDocument()

    // validator + comment prefilled from the existing rule
    const requiredSelect = screen.getByText(/Validator — require field/).querySelector('select')
    expect(requiredSelect.value).toBe('assignee')
    expect(screen.getByPlaceholderText('Comment text').value).toBe('done!')

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateWorkflowTransition).toHaveBeenCalledTimes(1))
    expect(updateWorkflowTransition).toHaveBeenCalledWith(5, {
      validators: [{ type: 'required_field', field: 'assignee' }],
      postFunctions: [{ type: 'add_comment', text: 'done!' }],
    })
  })
})

describe('JL-272 — real project statuses in dropdowns', () => {
  it('shows a custom project status in the From/To dropdowns', async () => {
    render(<WorkflowEditorPage />)
    // wait for statuses to load into the From dropdown
    const fromSelect = await screen.findByLabelText('From status')
    await waitFor(() =>
      expect(within(fromSelect).getByRole('option', { name: 'QA Review' })).toBeInTheDocument()
    )
    const toSelect = screen.getByLabelText('To status')
    expect(within(toSelect).getByRole('option', { name: 'QA Review' })).toBeInTheDocument()
    expect(fetchProjectStatuses).toHaveBeenCalledWith('1')
  })
})
