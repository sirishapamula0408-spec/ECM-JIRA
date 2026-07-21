// JL-275 / JL-276 — Workflow Editor redesign.
//  - JL-275: Atlassian-style two-column layout. Canvas column (left, flex:1) +
//    right sidebar (~360px) that holds BOTH the Properties panel and the
//    Transition rules panel (moved out of the old full-width bottom slot).
//  - JL-276: Add Status dialog exposes a preset quick-picker that pre-fills the
//    status name + category + color (all still editable).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

// ── Permission mock ──
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ isAdmin: true }),
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
import { fetchProjectStatuses } from '../api/issueConfigApi'
import { fetchWorkflowTransitions } from '../api/workflowTransitionApi'
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
  localStorage.clear()
  fetchProjects.mockResolvedValue([{ id: 1, name: 'Test Project' }])
  fetchProjectStatuses.mockResolvedValue(STATUSES)
  fetchWorkflowTransitions.mockResolvedValue(TRANSITIONS)
})

describe('JL-275 — two-column layout', () => {
  it('renders a canvas column and a right sidebar containing the Transition rules panel', async () => {
    render(<WorkflowEditorPage />)
    // wait for load
    await screen.findByRole('button', { name: /Status To Do/ })

    const canvasCol = screen.getByTestId('wfe-canvas-column')
    const sidebar = screen.getByTestId('wfe-sidebar')
    expect(canvasCol).toBeInTheDocument()
    expect(sidebar).toBeInTheDocument()

    // The Transition rules panel lives INSIDE the sidebar, not the canvas column.
    expect(within(sidebar).getByText(/Transition rules/i)).toBeInTheDocument()
    expect(within(canvasCol).queryByText(/Transition rules/i)).not.toBeInTheDocument()

    // The Properties heading is in the sidebar too.
    expect(within(sidebar).getByText('Properties')).toBeInTheDocument()
  })
})

describe('JL-276 — Add Status preset quick-picker', () => {
  it('exposes a preset picker that pre-fills name + category when "In Code Review" is chosen', async () => {
    render(<WorkflowEditorPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Add status/ }))

    const dialog = await screen.findByRole('dialog')
    const preset = within(dialog).getByLabelText('Preset (optional)')
    expect(preset).toBeInTheDocument()

    fireEvent.change(preset, { target: { value: 'In Code Review' } })

    // Name field pre-filled, category set to In Progress (backend 'inprogress').
    expect(within(dialog).getByLabelText('Status name')).toHaveValue('In Code Review')
    expect(within(dialog).getByLabelText('Category')).toHaveValue('inprogress')

    // Fields remain editable afterwards.
    fireEvent.change(within(dialog).getByLabelText('Status name'), { target: { value: 'Peer Review' } })
    expect(within(dialog).getByLabelText('Status name')).toHaveValue('Peer Review')
  })
})
