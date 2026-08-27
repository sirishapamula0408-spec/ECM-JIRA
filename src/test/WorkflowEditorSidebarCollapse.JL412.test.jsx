// JL-412 — Workflow Editor: collapsible properties sidebar.
//
// The editor is a two-column layout: the diagram canvas on the left and a 360px
// sidebar on the right carrying the Properties panel and the Transition rules
// panel. This suite covers the collapse toggle that now sits on the divider
// between them — the happy path, the accessibility contract, the persistence,
// and the failure modes (storage unavailable, a stale stored value, a selection
// made while the panel is shut).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'

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
vi.mock('../api/workflowDefinitionApi', () => ({
  fetchWorkflowDefinitions: vi.fn(),
  applyWorkflowTemplate: vi.fn(),
  createWorkflowDefinition: vi.fn(),
}))
vi.mock('../api/workflowLayoutApi', () => ({
  fetchWorkflowLayout: vi.fn(),
  saveWorkflowLayout: vi.fn(),
}))

import { fetchProjects } from '../api/projectApi'
import { fetchProjectStatuses } from '../api/issueConfigApi'
import { fetchWorkflowTransitions } from '../api/workflowTransitionApi'
import { fetchWorkflowDefinitions } from '../api/workflowDefinitionApi'
import { fetchWorkflowLayout, saveWorkflowLayout } from '../api/workflowLayoutApi'
import { WorkflowEditorPage } from '../pages/WorkflowEditorPage/WorkflowEditorPage'

const STORAGE_KEY = 'wfEditor:sidebarCollapsed'

const STATUSES = [
  { id: 10, project_id: 1, name: 'To Do', category: 'todo', color: '#DEEBFF' },
  { id: 11, project_id: 1, name: 'In Progress', category: 'inprogress', color: '#FFF0B3' },
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
  fetchWorkflowDefinitions.mockResolvedValue([])
  fetchWorkflowLayout.mockResolvedValue({ positions: {} })
  saveWorkflowLayout.mockResolvedValue({})
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Render and wait for the canvas to finish its initial load. */
async function renderEditor() {
  render(<WorkflowEditorPage />)
  await screen.findByRole('button', { name: /Status To Do/ })
}

const toggle = () => screen.getByTestId('wfe-sidebar-toggle')
const sidebar = () => screen.getByTestId('wfe-sidebar')

// ───────────────────────── positive scenarios ─────────────────────────

describe('JL-412 — collapse toggle on the canvas/sidebar divider', () => {
  it('renders the toggle between the canvas column and the sidebar', async () => {
    await renderEditor()

    const canvasCol = screen.getByTestId('wfe-canvas-column')
    const children = Array.from(canvasCol.parentElement.children)
    const canvasIdx = children.indexOf(canvasCol)
    const dividerIdx = children.indexOf(toggle().parentElement)
    const sidebarIdx = children.indexOf(sidebar())

    // The divider is a real sibling sitting BETWEEN the two columns.
    expect(canvasIdx).toBeGreaterThanOrEqual(0)
    expect(dividerIdx).toBe(canvasIdx + 1)
    expect(sidebarIdx).toBe(dividerIdx + 1)
  })

  it('starts expanded, and collapsing hides the Properties and Transition rules panels', async () => {
    await renderEditor()

    expect(sidebar()).toHaveAttribute('data-collapsed', 'false')
    expect(within(sidebar()).getByText('Properties')).toBeInTheDocument()
    expect(within(sidebar()).getByText(/Transition rules/i)).toBeInTheDocument()

    fireEvent.click(toggle())

    // The panels stay mounted (so aria-controls resolves) but are marked hidden
    // and inert, which takes them out of the accessibility tree and tab order.
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')
    expect(sidebar()).toHaveAttribute('aria-hidden', 'true')
    expect(sidebar()).toHaveAttribute('inert')
  })

  it('expands again on a second click, restoring the panels', async () => {
    await renderEditor()

    fireEvent.click(toggle())
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')

    fireEvent.click(toggle())
    expect(sidebar()).toHaveAttribute('data-collapsed', 'false')
    expect(sidebar()).not.toHaveAttribute('aria-hidden')
    expect(sidebar()).not.toHaveAttribute('inert')
    expect(within(sidebar()).getByText('Properties')).toBeInTheDocument()
  })

  it('exposes the state to assistive tech via aria-expanded and aria-controls', async () => {
    await renderEditor()

    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    // aria-controls must resolve to a real element — the sidebar itself.
    expect(toggle()).toHaveAttribute('aria-controls', 'wfe-sidebar')
    expect(document.getElementById('wfe-sidebar')).toBe(sidebar())

    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('names the action rather than the state, and flips the chevron with it', async () => {
    await renderEditor()

    expect(toggle()).toHaveAccessibleName('Collapse properties panel')
    expect(toggle()).toHaveTextContent('›') // > — points at the sidebar

    fireEvent.click(toggle())

    expect(toggle()).toHaveAccessibleName('Expand properties panel')
    expect(toggle()).toHaveTextContent('‹') // < — points back at the canvas
  })

  it('is a real button, so it is reachable and operable from the keyboard', async () => {
    await renderEditor()

    expect(toggle().tagName).toBe('BUTTON')
    expect(toggle()).toHaveAttribute('type', 'button')

    // A native <button> fires click for both Enter and Space; assert the wiring.
    toggle().focus()
    expect(document.activeElement).toBe(toggle())
    fireEvent.click(toggle())
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')
  })

  it('persists the collapsed choice to localStorage', async () => {
    await renderEditor()

    fireEvent.click(toggle())
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')

    fireEvent.click(toggle())
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
  })

  it('restores a collapsed sidebar on the next visit', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    await renderEditor()

    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('leaves the canvas, its nodes and the zoom controls untouched while collapsed', async () => {
    await renderEditor()
    fireEvent.click(toggle())

    // The diagram is the whole point of collapsing — it must still be there.
    expect(screen.getByTestId('wfe-canvas-column')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Status To Do/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
  })
})

describe('JL-412 — selecting something re-opens the panel', () => {
  it('expands when a status node is clicked while collapsed', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    await renderEditor()
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')

    fireEvent.click(screen.getByRole('button', { name: /Status To Do/ }))

    // Otherwise the click would look like it did nothing.
    await waitFor(() => expect(sidebar()).toHaveAttribute('data-collapsed', 'false'))
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0')
  })

  it('expands when a status node is selected with the keyboard while collapsed', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    await renderEditor()

    const node = screen.getByRole('button', { name: /Status In Progress/ })
    fireEvent.keyDown(node, { key: 'Enter' })

    await waitFor(() => expect(sidebar()).toHaveAttribute('data-collapsed', 'false'))
  })

  it('does NOT re-open when the user merely clears the selection on empty canvas', async () => {
    await renderEditor()

    // Select a node (panel open), collapse, then click empty canvas.
    fireEvent.click(screen.getByRole('button', { name: /Status To Do/ }))
    fireEvent.click(toggle())
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')

    fireEvent.click(screen.getByTestId('wfe-canvas-column').firstChild)

    // Deselecting is not a request to see properties — the panel stays shut.
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')
  })

  it('moves focus out of the sidebar when it is collapsed, instead of stranding it', async () => {
    await renderEditor()

    // Focus something inside the sidebar, then collapse via the toggle.
    const inside = within(sidebar()).getAllByRole('button')[0]
    inside.focus()
    expect(sidebar().contains(document.activeElement)).toBe(true)

    fireEvent.click(toggle())

    expect(sidebar().contains(document.activeElement)).toBe(false)
    expect(document.activeElement).toBe(toggle())
  })
})

// ───────────────────────── negative / edge scenarios ─────────────────────────

describe('JL-412 — degrades safely', () => {
  it('starts expanded when localStorage holds a value from an older build', async () => {
    localStorage.setItem(STORAGE_KEY, 'yes-please')
    await renderEditor()

    // Anything that is not exactly '1' means "expanded" — never a crash.
    expect(sidebar()).toHaveAttribute('data-collapsed', 'false')
  })

  it('starts expanded when reading localStorage throws', async () => {
    const spy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })

    await renderEditor()

    expect(sidebar()).toHaveAttribute('data-collapsed', 'false')
    spy.mockRestore()
  })

  it('still toggles when writing to localStorage throws', async () => {
    await renderEditor()

    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })

    // Losing the preference must not cost the user the interaction.
    expect(() => fireEvent.click(toggle())).not.toThrow()
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')

    spy.mockRestore()
  })

  it('renders the toggle even when the project list fails to load', async () => {
    fetchProjects.mockRejectedValue(new Error('network down'))
    render(<WorkflowEditorPage />)

    // No project means no canvas, but the layout control is still operable.
    expect(await screen.findByTestId('wfe-sidebar-toggle')).toBeInTheDocument()
    fireEvent.click(toggle())
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')
  })

  it('survives rapid double-toggling without desynchronising state and storage', async () => {
    await renderEditor()

    fireEvent.click(toggle())
    fireEvent.click(toggle())
    fireEvent.click(toggle())

    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })
})
