import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from '../pages/DashboardPage/DashboardPage'
import { useDashboardLayout } from '../hooks/useDashboardLayout'
import { PieChartGadget } from '../components/dashboard/gadgets/PieChartGadget'
import { DonutChartGadget } from '../components/dashboard/gadgets/DonutChartGadget'

// The dashboard reads issues/activity from context and projects from the API.
// Stub them all — none affect the resize / rearrange / chart behaviour under test.
vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: [] }),
}))
vi.mock('../context/AppDataContext', () => ({
  useAppData: () => ({ activity: [] }),
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ profile: null, members: [] }),
}))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([]),
}))

const STORAGE_KEY = 'jira_dashboard_layout'

// Row 1: A/B/C small (fills 3 cols). Row 2: D large (2 cols) -> 1-col trailing gap.
// The old gap-filling reflow expanded D back to 'full' on resize/reorder, which is
// exactly the JL-299 "can't resize / rearrange" defect.
const SEED = {
  title: 'Dashboard',
  gadgets: [
    { id: 'g1', type: 'bar', title: 'Gadget A', size: 'small', config: {}, order: 0 },
    { id: 'g2', type: 'bar', title: 'Gadget B', size: 'small', config: {}, order: 1 },
    { id: 'g3', type: 'bar', title: 'Gadget C', size: 'small', config: {}, order: 2 },
    { id: 'g4', type: 'bar', title: 'Gadget D', size: 'large', config: {}, order: 3 },
  ],
}

function seed(layout = SEED) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
}
function readLayout() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY))
}
function bySize(gadgets, id) {
  return gadgets.find((g) => g.id === id).size
}

// JL-336: the chart legends now render <Link>s into the issue list, so the
// gadgets need router context even when rendered standalone.
const renderGadget = (ui) => render(ui, { wrapper: MemoryRouter })

const STATUS_ISSUES = [
  { id: 1, status: 'To Do' },
  { id: 2, status: 'To Do' },
  { id: 3, status: 'To Do' },
  { id: 4, status: 'In Progress' },
  { id: 5, status: 'Done' },
  { id: 6, status: 'Done' },
]

describe('JL-299 — dashboard gadget resize', () => {
  beforeEach(() => {
    localStorage.clear()
    seed()
  })

  it('persists an explicit resize instead of snapping it back (reflow no longer overrides)', () => {
    const { result } = renderHook(() => useDashboardLayout())

    // Shrink the last gadget. Under the buggy reflow this immediately became 'full'.
    act(() => result.current.updateGadgetSize('g4', 'small'))

    expect(bySize(result.current.gadgets, 'g4')).toBe('small')
    expect(bySize(readLayout().gadgets, 'g4')).toBe('small')
  })

  it('resizing one gadget does not mutate the sizes of the others', () => {
    const { result } = renderHook(() => useDashboardLayout())

    act(() => result.current.updateGadgetSize('g1', 'large'))

    const layout = readLayout()
    expect(bySize(layout.gadgets, 'g1')).toBe('large')
    expect(bySize(layout.gadgets, 'g2')).toBe('small')
    expect(bySize(layout.gadgets, 'g3')).toBe('small')
    expect(bySize(layout.gadgets, 'g4')).toBe('large')
  })

  it('exposes a Resize control on every rendered gadget', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    await screen.findByText('Gadget A')
    expect(screen.getAllByTitle('Resize')).toHaveLength(4)
  })
})

describe('JL-299 — dashboard gadget rearrange', () => {
  beforeEach(() => {
    localStorage.clear()
    seed()
  })

  it('reorders gadgets and persists the new order without resizing them', () => {
    const { result } = renderHook(() => useDashboardLayout())

    // Move the first gadget (index 0) to the last slot (index 3).
    act(() => result.current.reorderGadgets(0, 3))

    const layout = readLayout()
    const orderedIds = [...layout.gadgets]
      .sort((a, b) => a.order - b.order)
      .map((g) => g.id)
    expect(orderedIds).toEqual(['g2', 'g3', 'g4', 'g1'])
    // orders stay contiguous 0..3
    expect([...layout.gadgets].map((g) => g.order).sort()).toEqual([0, 1, 2, 3])
    // sizes are untouched by the reorder
    expect(bySize(layout.gadgets, 'g4')).toBe('large')
    expect(bySize(layout.gadgets, 'g1')).toBe('small')
  })

  it('ignores out-of-range reorder requests', () => {
    const { result } = renderHook(() => useDashboardLayout())
    act(() => result.current.reorderGadgets(0, 99))
    const orderedIds = [...readLayout().gadgets]
      .sort((a, b) => a.order - b.order)
      .map((g) => g.id)
    expect(orderedIds).toEqual(['g1', 'g2', 'g3', 'g4'])
  })

  it('renders draggable gadget headers so drag-to-reorder can start', async () => {
    const { container } = render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    await screen.findByText('Gadget A')
    const headers = container.querySelectorAll('.gadget-header[draggable="true"]')
    expect(headers.length).toBe(4)
    // and each carries a drag handle affordance
    expect(container.querySelectorAll('.gadget-drag-handle').length).toBe(4)
  })
})

describe('JL-299 — pie/doughnut chart labels', () => {
  it('renders visible percentage labels on pie slices', () => {
    const { container } = renderGadget(
      <PieChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status', showLabels: true }} />,
    )
    const labels = container.querySelectorAll('text.pie-gadget-slice-label')
    expect(labels.length).toBeGreaterThan(0)
    // Percentages sum-visible, e.g. "50%" for the two To Do... at least one "%".
    expect(Array.from(labels).some((t) => t.textContent.includes('%'))).toBe(true)
  })

  it('renders visible percentage labels on doughnut slices', () => {
    const { container } = renderGadget(
      <DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status', showLabels: true }} />,
    )
    const labels = container.querySelectorAll('text.pie-gadget-slice-label')
    expect(labels.length).toBeGreaterThan(0)
    expect(Array.from(labels).some((t) => t.textContent.includes('%'))).toBe(true)
  })

  it('omits on-slice labels when showLabels is false', () => {
    const { container } = renderGadget(
      <PieChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status', showLabels: false }} />,
    )
    expect(container.querySelectorAll('text.pie-gadget-slice-label').length).toBe(0)
  })
})

describe('JL-299 — chart hover does not flicker', () => {
  it('keeps a single hovered tooltip; clearing is bound to the svg, not each slice', () => {
    const { container } = renderGadget(
      <DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status', showLabels: true }} />,
    )
    const svg = container.querySelector('svg.pie-gadget-svg')
    const firstSlice = svg.querySelector('path')

    fireEvent.mouseEnter(firstSlice)
    // exactly one tooltip is shown
    expect(container.querySelectorAll('.pie-gadget-tooltip').length).toBe(1)

    // moving off the chart entirely (svg leave) clears it — no per-slice churn
    fireEvent.mouseLeave(svg)
    return waitFor(() => {
      expect(container.querySelectorAll('.pie-gadget-tooltip').length).toBe(0)
    })
  })
})
