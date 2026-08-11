// JL-330 — Workflow Editor layout: server-side persistence, snap-to-grid, touch.
//
//  1. node positions are PUT to the server (not localStorage) after a drag;
//  2. the saved layout is fetched on mount and rendered;
//  3. a dropped node snaps onto the 20px grid;
//  4. a pre-JL-330 localStorage layout is migrated up rather than lost;
//  5. a pointer (touch/pen/mouse) drag moves and saves a node.
//
// NOTE on (5): jsdom has no real touch input. Firing a synthetic pointer
// sequence proves the pointer handlers are wired to the canvas and produce the
// same state changes as the mouse path — it does NOT prove the gesture feels
// right on a physical tablet. That has not been device-verified.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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
import { snapToGrid, GRID_SIZE } from '../utils/layoutGrid'

const STATUSES = [
  { id: 10, project_id: 1, name: 'To Do', category: 'todo', color: '#DEEBFF' },
  { id: 11, project_id: 1, name: 'In Progress', category: 'inprogress', color: '#FFF0B3' },
]

const LOCAL_KEY = 'wfEditor:positions:1'

// jsdom reports zeros from getBoundingClientRect and the canvas is at zoom 1,
// so canvas coordinates equal client coordinates.
const canvasEl = () => document.querySelector('.wfe-canvas-wrapper')
const nodeEl = (name) => screen.getByRole('button', { name: new RegExp(`Status ${name}`) })

/** Auto-layout position of the first node (autoPos(0) in the page). */
const FIRST_NODE = { x: 60, y: 70 }

/** Drag the named node from `from` to `to` using mouse events. */
function mouseDrag(name, from, to) {
  fireEvent.mouseDown(nodeEl(name), { clientX: from.x, clientY: from.y })
  fireEvent.mouseMove(canvasEl(), { clientX: to.x, clientY: to.y })
  fireEvent.mouseUp(canvasEl(), { clientX: to.x, clientY: to.y })
}

/** The same drag through PointerEvents — the path a touch/pen device takes. */
function pointerDrag(name, from, to, pointerType = 'touch') {
  fireEvent.pointerDown(nodeEl(name), { clientX: from.x, clientY: from.y, pointerId: 1, pointerType })
  fireEvent.pointerMove(canvasEl(), { clientX: to.x, clientY: to.y, pointerId: 1, pointerType })
  fireEvent.pointerUp(canvasEl(), { clientX: to.x, clientY: to.y, pointerId: 1, pointerType })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAdmin = true
  localStorage.clear()
  fetchProjects.mockResolvedValue([{ id: 1, name: 'Test Project' }])
  fetchProjectStatuses.mockResolvedValue(STATUSES)
  fetchWorkflowTransitions.mockResolvedValue([])
  fetchWorkflowDefinitions.mockResolvedValue([])
  fetchWorkflowLayout.mockResolvedValue({ projectId: 1, positions: {}, updatedAt: null })
  saveWorkflowLayout.mockResolvedValue({ projectId: 1, positions: {}, updatedAt: 'now' })
})

/* ── 1. Positions are persisted to the server ──────────────────────────── */

describe('JL-330 — node positions persist to the server', () => {
  it('PUTs the layout after a drag instead of writing localStorage', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    mouseDrag('To Do', FIRST_NODE, { x: 340, y: 240 })

    await waitFor(() => {
      // projectId comes from the <select>, so it is the string '1' — the same
      // value every other call site on this page passes.
      expect(saveWorkflowLayout).toHaveBeenCalledWith('1', { 'To Do': { x: 340, y: 240 } })
    })
    // The layout is server state now; nothing is left behind in localStorage.
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull()
  })

  it('does not save when the viewer may not edit the workflow', async () => {
    mockIsAdmin = false
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    mouseDrag('To Do', FIRST_NODE, { x: 340, y: 240 })

    // A Viewer's drag is a no-op (the node isn't draggable at all), and in no
    // case may it write the shared layout.
    await new Promise((r) => setTimeout(r, 320))
    expect(saveWorkflowLayout).not.toHaveBeenCalled()
  })

  it('clears the shared layout when Reset layout is used', async () => {
    fetchWorkflowLayout.mockResolvedValue({ projectId: 1, positions: { 'To Do': { x: 300, y: 200 } } })
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    fireEvent.click(screen.getByRole('button', { name: /Reset layout/i }))

    await waitFor(() => expect(saveWorkflowLayout).toHaveBeenCalledWith('1', {}))
  })

  it('warns the user when the layout cannot be saved', async () => {
    saveWorkflowLayout.mockRejectedValue(new Error('boom'))
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    mouseDrag('To Do', FIRST_NODE, { x: 340, y: 240 })

    expect(await screen.findByText(/Could not save the workflow layout/i)).toBeInTheDocument()
  })
})

/* ── 2. Positions are loaded from the server on mount ──────────────────── */

describe('JL-330 — layout loads from the server', () => {
  it('renders nodes at the coordinates the server returned', async () => {
    fetchWorkflowLayout.mockResolvedValue({
      projectId: 1,
      positions: { 'To Do': { x: 300, y: 200 }, 'In Progress': { x: 520, y: 380 } },
    })
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    await waitFor(() => expect(nodeEl('To Do').style.left).toBe('300px'))
    expect(nodeEl('To Do').style.top).toBe('200px')
    expect(nodeEl('In Progress').style.left).toBe('520px')
    expect(nodeEl('In Progress').style.top).toBe('380px')
    expect(fetchWorkflowLayout).toHaveBeenCalledWith('1')
  })

  it('falls back to auto-layout when the project has no saved layout', async () => {
    render(<WorkflowEditorPage />)
    const node = await screen.findByRole('button', { name: /Status To Do/ })
    expect(node.style.left).toBe(`${FIRST_NODE.x}px`)
    expect(node.style.top).toBe(`${FIRST_NODE.y}px`)
  })
})

/* ── 3. Snap to grid ───────────────────────────────────────────────────── */

describe('JL-330 — snap-to-grid', () => {
  it('rounds a coordinate onto the 20px grid and never goes negative', () => {
    // A named constant, not a magic number — and it matches the canvas's dotted
    // 20px background so a snapped node lands on a visible dot.
    expect(GRID_SIZE).toBe(20)
    expect(snapToGrid(0)).toBe(0)
    expect(snapToGrid(9)).toBe(0)
    expect(snapToGrid(11)).toBe(20)
    expect(snapToGrid(333)).toBe(340)
    expect(snapToGrid(247)).toBe(240)
    expect(snapToGrid(-5)).toBe(0)
  })

  it('snaps a dropped node to the grid and saves the snapped position', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    // Drop at an off-grid point: 333 → 340, 247 → 240.
    mouseDrag('To Do', FIRST_NODE, { x: 333, y: 247 })

    await waitFor(() => expect(nodeEl('To Do').style.left).toBe('340px'))
    expect(nodeEl('To Do').style.top).toBe('240px')
    await waitFor(() => {
      expect(saveWorkflowLayout).toHaveBeenCalledWith('1', { 'To Do': { x: 340, y: 240 } })
    })
  })

  it('follows the pointer un-snapped mid-drag, snapping only on drop', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    fireEvent.mouseDown(nodeEl('To Do'), { clientX: FIRST_NODE.x, clientY: FIRST_NODE.y })
    fireEvent.mouseMove(canvasEl(), { clientX: 333, clientY: 247 })
    // Mid-drag the node sits exactly under the pointer, so the drag doesn't feel
    // sticky; the grid is applied by the drop.
    await waitFor(() => expect(nodeEl('To Do').style.left).toBe('333px'))

    fireEvent.mouseUp(canvasEl())
    await waitFor(() => expect(nodeEl('To Do').style.left).toBe('340px'))
  })
})

/* ── 4. localStorage migration ─────────────────────────────────────────── */

describe('JL-330 — legacy localStorage layout migration', () => {
  it('adopts a local layout when the server has none, uploads it, and clears the key', async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ 'To Do': { x: 160, y: 120 } }))
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    // Rendered from the migrated local layout, not auto-layout.
    await waitFor(() => expect(nodeEl('To Do').style.left).toBe('160px'))
    await waitFor(() => {
      expect(saveWorkflowLayout).toHaveBeenCalledWith('1', { 'To Do': { x: 160, y: 120 } })
    })
    // Only removed once the upload succeeded, so the layout is never lost.
    await waitFor(() => expect(localStorage.getItem(LOCAL_KEY)).toBeNull())
  })

  it('keeps the local key when the upload fails, so the next load retries', async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ 'To Do': { x: 160, y: 120 } }))
    saveWorkflowLayout.mockRejectedValue(new Error('offline'))
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    await waitFor(() => expect(saveWorkflowLayout).toHaveBeenCalled())
    expect(localStorage.getItem(LOCAL_KEY)).not.toBeNull()
    expect(nodeEl('To Do').style.left).toBe('160px')
  })

  it('prefers the shared server layout over a stale local one', async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ 'To Do': { x: 160, y: 120 } }))
    fetchWorkflowLayout.mockResolvedValue({ projectId: 1, positions: { 'To Do': { x: 400, y: 300 } } })
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    await waitFor(() => expect(nodeEl('To Do').style.left).toBe('400px'))
    // No migration: the server already holds the shared truth.
    expect(saveWorkflowLayout).not.toHaveBeenCalled()
  })

  it('still renders the local layout when the server is unreachable', async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ 'To Do': { x: 160, y: 120 } }))
    fetchWorkflowLayout.mockRejectedValue(new Error('network down'))
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    await waitFor(() => expect(nodeEl('To Do').style.left).toBe('160px'))
    // Nothing is uploaded while we cannot tell what the server holds.
    expect(saveWorkflowLayout).not.toHaveBeenCalled()
    expect(localStorage.getItem(LOCAL_KEY)).not.toBeNull()
  })

  it('does not migrate for a user who may not edit the workflow', async () => {
    mockIsAdmin = false
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ 'To Do': { x: 160, y: 120 } }))
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    await waitFor(() => expect(nodeEl('To Do').style.left).toBe('160px'))
    expect(saveWorkflowLayout).not.toHaveBeenCalled()
    expect(localStorage.getItem(LOCAL_KEY)).not.toBeNull()
  })
})

/* ── 5. Pointer (touch) dragging ───────────────────────────────────────── */

describe('JL-330 — pointer/touch dragging', () => {
  it('moves and saves a node from a touch-type pointer drag', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    pointerDrag('To Do', FIRST_NODE, { x: 333, y: 247 }, 'touch')

    await waitFor(() => expect(nodeEl('To Do').style.left).toBe('340px'))
    expect(nodeEl('To Do').style.top).toBe('240px')
    await waitFor(() => {
      expect(saveWorkflowLayout).toHaveBeenCalledWith('1', { 'To Do': { x: 340, y: 240 } })
    })
  })

  it('handles a pen pointer through the same path', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    pointerDrag('In Progress', { x: 320, y: 70 }, { x: 200, y: 400 }, 'pen')

    await waitFor(() => expect(nodeEl('In Progress').style.top).toBe('400px'))
  })

  it('ignores the mouse compatibility events a browser fires after a pointer gesture', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    pointerDrag('To Do', FIRST_NODE, { x: 333, y: 247 }, 'touch')
    await waitFor(() => expect(nodeEl('To Do').style.left).toBe('340px'))

    // Real browsers follow a touch gesture with mousedown/mousemove/mouseup on
    // the same element. Replaying the gesture through them must not move the
    // node a second time.
    mouseDrag('To Do', FIRST_NODE, { x: 700, y: 700 })
    await new Promise((r) => setTimeout(r, 50))
    expect(nodeEl('To Do').style.left).toBe('340px')
  })

  it('completes a pointer gesture once even though touch fires up then leave', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    fireEvent.pointerDown(nodeEl('To Do'), { clientX: FIRST_NODE.x, clientY: FIRST_NODE.y, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerMove(canvasEl(), { clientX: 333, clientY: 247, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerUp(canvasEl(), { pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerLeave(canvasEl(), { pointerId: 1, pointerType: 'touch' })

    await waitFor(() => expect(saveWorkflowLayout).toHaveBeenCalledTimes(1))
    expect(saveWorkflowLayout).toHaveBeenCalledWith('1', { 'To Do': { x: 340, y: 240 } })
  })
})
