// JL-307 — Workflow Editor: Atlassian-style sizing for status & transition nodes.
//  Status nodes were large 180×60 boxes; they are now compact 140×44 lozenges
//  whose dimensions are driven inline from NODE_WIDTH/NODE_HEIGHT (the same
//  constants feed the SVG arrow geometry, so drag/positioning stays in sync).
//  Transition arrow labels still render "From → To" text.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

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

// Expected compact node dimensions (must match NODE_WIDTH / NODE_HEIGHT).
const EXPECTED_NODE_WIDTH = '140px'
const EXPECTED_NODE_HEIGHT = '44px'

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

describe('JL-307 — compact Atlassian-style status nodes', () => {
  it('renders each status node with the compact 140×44 inline dimensions', async () => {
    render(<WorkflowEditorPage />)
    const node = await screen.findByRole('button', { name: /Status To Do/ })

    // Carries the node class and the compact inline size (single source of truth).
    expect(node).toHaveClass('wfe-node')
    expect(node.style.width).toBe(EXPECTED_NODE_WIDTH)
    expect(node.style.height).toBe(EXPECTED_NODE_HEIGHT)

    // All status nodes share the same compact sizing.
    for (const name of ['To Do', 'In Progress', 'Done']) {
      const n = screen.getByRole('button', { name: new RegExp(`Status ${name}`) })
      expect(n.style.width).toBe(EXPECTED_NODE_WIDTH)
      expect(n.style.height).toBe(EXPECTED_NODE_HEIGHT)
    }
  })

  it('renders the status name and its category sub-label inside the node', async () => {
    render(<WorkflowEditorPage />)
    const node = await screen.findByRole('button', { name: /Status In Progress/ })
    expect(within(node).getByText('In Progress')).toHaveClass('wfe-node-name')
    expect(within(node).getByText('inprogress')).toHaveClass('wfe-node-category')
  })
})

describe('JL-307 — transition arrows + labels', () => {
  it('renders a legible "From → To" label for each transition', async () => {
    const { container } = render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    const label = container.querySelector('.wfe-arrow-label')
    expect(label).toBeInTheDocument()
    expect(label.textContent.replace(/\s+/g, ' ').trim()).toBe('To Do → In Progress')

    // The transition line + arrowhead marker still render.
    expect(container.querySelector('.wfe-arrow-line')).toBeInTheDocument()
    expect(container.querySelector('#wfe-arrowhead')).toBeInTheDocument()
  })
})
