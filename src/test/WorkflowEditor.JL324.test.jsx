// JL-324 — Workflow Editor fixes:
//   1. default-workflow indicator is styled + states the "none" case explicitly
//   2. status nodes drop the raw category sub-label; transition labels stay clear
//   3. node fills are light with a readable, contrast-derived label colour
//   4. drag from a node's connector onto another node creates a transition
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import {
  contrastRatio,
  readableTextColor,
  borderFor,
  relativeLuminance,
  parseHex,
} from '../utils/color'

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
import { fetchProjectStatuses } from '../api/issueConfigApi'
import { fetchWorkflowTransitions, createWorkflowTransition } from '../api/workflowTransitionApi'
import { fetchWorkflowDefinitions } from '../api/workflowDefinitionApi'
import { WorkflowEditorPage } from '../pages/WorkflowEditorPage/WorkflowEditorPage'

const NODE_WIDTH = 140
const NODE_HEIGHT = 44

// Auto-layout places node i at x = 60 + (i%5)*260, y = 70 + floor(i/5)*170.
const autoPos = (i) => ({ x: 60 + (i % 5) * 260, y: 70 + Math.floor(i / 5) * 170 })
const centerOf = (i) => {
  const p = autoPos(i)
  return { x: p.x + NODE_WIDTH / 2, y: p.y + NODE_HEIGHT / 2 }
}

const STATUSES = [
  { id: 10, project_id: 1, name: 'To Do', category: 'todo', color: '#F4F5F7' },
  { id: 11, project_id: 1, name: 'In Progress', category: 'inprogress', color: '#DEEBFF' },
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
  fetchWorkflowDefinitions.mockResolvedValue([])
  createWorkflowTransition.mockResolvedValue({ id: 99 })
})

/* ── 1. Default workflow indicator ─────────────────────────────────────── */

describe('JL-324 — default workflow indicator', () => {
  it('shows a styled badge (not the generic .chip) when a default exists', async () => {
    fetchWorkflowDefinitions.mockResolvedValue([
      { id: 5, name: 'QA Lifecycle', isDefault: true, cancelFromAny: false },
      { id: 6, name: 'Other', isDefault: false },
    ])
    render(<WorkflowEditorPage />)

    const badge = await screen.findByTestId('wfe-default-workflow')
    expect(badge).toHaveTextContent('Default workflow: QA Lifecycle')
    expect(badge).toHaveClass('wfe-default-workflow-badge')
    // The badge used to fall back to `.chip`, which rendered it as a toolbar button.
    expect(badge).not.toHaveClass('chip')
  })

  it('says so explicitly when the project has no default workflow', async () => {
    fetchWorkflowDefinitions.mockResolvedValue([])
    render(<WorkflowEditorPage />)

    // Previously nothing rendered at all — indistinguishable from a failed fetch.
    const badge = await screen.findByTestId('wfe-no-default-workflow')
    expect(badge).toHaveTextContent('No default workflow')
    expect(screen.queryByTestId('wfe-default-workflow')).not.toBeInTheDocument()
  })

  it('appends the cancel-from-any note when the default allows it', async () => {
    fetchWorkflowDefinitions.mockResolvedValue([
      { id: 5, name: 'QA Lifecycle', isDefault: true, cancelFromAny: true },
    ])
    render(<WorkflowEditorPage />)
    expect(await screen.findByTestId('wfe-default-workflow')).toHaveTextContent('cancel from any')
  })
})

/* ── 2. Node content + transition labels ───────────────────────────────── */

describe('JL-324 — node content and transition labels', () => {
  it('no longer renders the raw category sub-label inside status nodes', async () => {
    const { container } = render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    expect(container.querySelector('.wfe-node-category')).toBeNull()
    for (const raw of ['todo', 'inprogress', 'done']) {
      expect(screen.queryByText(raw)).not.toBeInTheDocument()
    }
  })

  it('still exposes the category to assistive tech via aria-label', async () => {
    render(<WorkflowEditorPage />)
    const node = await screen.findByRole('button', { name: /Status In Progress/ })
    expect(node).toHaveAttribute('aria-label', 'Status In Progress, category In Progress')
  })

  it('places the transition label clear of both status boxes', async () => {
    const { container } = render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    const label = container.querySelector('.wfe-arrow-label')
    expect(label).toBeInTheDocument()

    const lx = Number(label.getAttribute('x'))
    const ly = Number(label.getAttribute('y'))

    // The label must not land inside any node's rectangle — that was the bug.
    STATUSES.forEach((_s, i) => {
      const p = autoPos(i)
      const inside =
        lx >= p.x && lx <= p.x + NODE_WIDTH && ly >= p.y && ly <= p.y + NODE_HEIGHT
      expect(inside).toBe(false)
    })
  })
})

/* ── 3. Colour / contrast ──────────────────────────────────────────────── */

describe('JL-324 — status node colours are readable', () => {
  it('derives a label colour that meets WCAG AA against the fill', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    for (const s of STATUSES) {
      const node = screen.getByRole('button', { name: new RegExp(`Status ${s.name}`) })
      const bg = node.style.backgroundColor
      const fg = node.style.color
      expect(bg).toBeTruthy()
      expect(fg).toBeTruthy()
      // Both are rgb() strings once through the DOM; compare via luminance.
      const ratio = contrastRatio(rgbToHex(bg), rgbToHex(fg))
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('stays readable even on a legacy dark fill (the original defect)', async () => {
    // #42526E was the seeded value; dark body text on it measured ~1.5:1.
    fetchProjectStatuses.mockResolvedValue([
      { id: 20, project_id: 1, name: 'Legacy', category: 'todo', color: '#42526E' },
    ])
    render(<WorkflowEditorPage />)
    const node = await screen.findByRole('button', { name: /Status Legacy/ })

    const ratio = contrastRatio(rgbToHex(node.style.backgroundColor), rgbToHex(node.style.color))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('derives the border from the fill so the two cannot disagree', async () => {
    render(<WorkflowEditorPage />)
    const node = await screen.findByRole('button', { name: /Status Done/ })
    // Previously the border came from the category while the fill came from the
    // status colour (grey Cancelled + mint-green `done` border).
    expect(rgbToHex(node.style.borderColor).toUpperCase())
      .toBe(borderFor('#E3FCEF').toUpperCase())
  })
})

/* ── 4. Drag to create a transition ────────────────────────────────────── */

describe('JL-324 — drag-to-create-transition', () => {
  function connectorFor(name) {
    const node = screen.getByRole('button', { name: new RegExp(`Status ${name}`) })
    return within(node).getByLabelText(`Drag from ${name} to create a transition`)
  }

  // The canvas maps clientX/Y through getBoundingClientRect; jsdom reports zeros,
  // so canvas coords == client coords, letting us aim at node centres directly.
  function dragFromTo(sourceName, target) {
    const canvas = document.querySelector('.wfe-canvas-wrapper')
    fireEvent.mouseDown(connectorFor(sourceName))
    fireEvent.mouseMove(canvas, { clientX: target.x, clientY: target.y })
    fireEvent.mouseUp(canvas)
  }

  it('creates a transition when dropped on another status', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    dragFromTo('In Progress', centerOf(2)) // drop on "Done"

    // projectId comes from the <select>, so it is the string '1' here — the same
    // value every other call site in this page passes.
    await waitFor(() => {
      expect(createWorkflowTransition).toHaveBeenCalledWith('1', {
        fromStatus: 'In Progress',
        toStatus: 'Done',
      })
    })
  })

  it('shows a preview line while dragging', async () => {
    const { container } = render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    expect(container.querySelector('[data-testid="wfe-link-preview"]')).toBeNull()
    fireEvent.mouseDown(connectorFor('To Do'))
    fireEvent.mouseMove(container.querySelector('.wfe-canvas-wrapper'), { clientX: 400, clientY: 200 })
    expect(container.querySelector('[data-testid="wfe-link-preview"]')).toBeInTheDocument()

    fireEvent.mouseUp(container.querySelector('.wfe-canvas-wrapper'))
    expect(container.querySelector('[data-testid="wfe-link-preview"]')).toBeNull()
  })

  it('ignores a drop on empty canvas', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    dragFromTo('To Do', { x: 900, y: 600 })
    await waitFor(() => expect(createWorkflowTransition).not.toHaveBeenCalled())
  })

  it('ignores a self-drop', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    dragFromTo('To Do', centerOf(0)) // back onto itself
    await waitFor(() => expect(createWorkflowTransition).not.toHaveBeenCalled())
  })

  it('refuses a duplicate transition and explains why', async () => {
    render(<WorkflowEditorPage />)
    await screen.findByRole('button', { name: /Status To Do/ })

    dragFromTo('To Do', centerOf(1)) // To Do → In Progress already exists

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
    expect(createWorkflowTransition).not.toHaveBeenCalled()
  })

  it('does not reposition the node when dragging from the connector', async () => {
    render(<WorkflowEditorPage />)
    const node = await screen.findByRole('button', { name: /Status To Do/ })
    const originalLeft = node.style.left

    dragFromTo('To Do', centerOf(2))

    // The link drag must not be mistaken for a move drag.
    expect(node.style.left).toBe(originalLeft)
    expect(localStorage.getItem('wfEditor:positions:1')).toBeNull()
  })
})

/* ── colour utility ───────────────────────────────────────────────────── */

describe('JL-324 — colour utility', () => {
  it('parses short and full hex', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHex('#0052CC')).toEqual({ r: 0, g: 82, b: 204 })
    expect(parseHex('nonsense')).toBeNull()
  })

  it('computes luminance at the extremes', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5)
  })

  it('picks dark text on light fills and light text on dark fills', () => {
    expect(readableTextColor('#F4F5F7')).toBe('#172B4D')
    expect(readableTextColor('#E3FCEF')).toBe('#172B4D')
    expect(readableTextColor('#42526E')).toBe('#FFFFFF')
    expect(readableTextColor('#0052CC')).toBe('#FFFFFF')
  })

  it('always clears WCAG AA for the shipped palette', () => {
    for (const bg of ['#F4F5F7', '#DEEBFF', '#E3FCEF', '#FFF0B3', '#FFEBE6', '#EAE6FF']) {
      expect(contrastRatio(bg, readableTextColor(bg))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('returns a border darker than its fill', () => {
    const fill = '#E3FCEF'
    expect(relativeLuminance(borderFor(fill))).toBeLessThan(relativeLuminance(fill))
  })
})

/** jsdom serialises inline colours as `rgb(r, g, b)`; convert back to hex. */
function rgbToHex(value) {
  const m = String(value).match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!m) return value
  const h = (n) => Number(n).toString(16).padStart(2, '0')
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`
}
