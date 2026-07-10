import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from '../pages/DashboardPage/DashboardPage'

// The dashboard reads issues/activity from context and projects from the API.
// None of that data matters for layout reflow, so we stub them all out.
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
const COLS = 3
const SIZE_SPAN = { small: 1, medium: 1, large: 2, full: 3 }

// Seed layout: every row is completely full (no holes) to begin with.
//   Row 1: A(small=1) B(small=1) C(small=1)  -> 3
//   Row 2: D(large=2) E(small=1)             -> 3
// Removing B leaves A,C,D,E. Without reflow that yields
//   Row 1: A(1) C(1)            -> 2  (a 1-column HOLE)
//   Row 2: D(2) E(1)            -> 3
// so a correct reflow must eliminate the trailing hole in row 1.
const SEED = {
  title: 'Dashboard',
  gadgets: [
    { id: 'g1', type: 'bar', title: 'Gadget A', size: 'small', config: {}, order: 0 },
    { id: 'g2', type: 'bar', title: 'Gadget B', size: 'small', config: {}, order: 1 },
    { id: 'g3', type: 'bar', title: 'Gadget C', size: 'small', config: {}, order: 2 },
    { id: 'g4', type: 'bar', title: 'Gadget D', size: 'large', config: {}, order: 3 },
    { id: 'g5', type: 'bar', title: 'Gadget E', size: 'small', config: {}, order: 4 },
  ],
}

// Walk the gadgets in order, packing them into rows of COLS columns.
// Returns { holes, trailingGap } — both must be 0 for a gap-free layout.
function analyzeLayout(gadgets) {
  const sorted = [...gadgets].sort((a, b) => a.order - b.order)
  let col = 0
  let holes = 0
  for (const g of sorted) {
    const span = SIZE_SPAN[g.size] || 1
    if (col + span > COLS) {
      // current gadget cannot fit on this row -> the remaining columns are a hole
      holes += COLS - col
      col = 0
    }
    col += span
    if (col === COLS) col = 0
  }
  const trailingGap = col === 0 ? 0 : COLS - col
  return { holes, trailingGap }
}

function readLayout() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY))
}

describe('DashboardPage — auto-reflow on widget removal', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED))
  })

  it('seed layout has no gaps to start with', () => {
    expect(analyzeLayout(SEED.gadgets)).toEqual({ holes: 0, trailingGap: 0 })
  })

  it('removes the widget and reflows remaining widgets to fill the freed space', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    // All five gadgets render initially.
    expect(await screen.findByText('Gadget B')).toBeInTheDocument()
    const removeButtons = screen.getAllByTitle('Remove')
    expect(removeButtons).toHaveLength(5)

    // Remove "Gadget B" (the second gadget in order).
    fireEvent.click(removeButtons[1])

    // The removed gadget is gone; the others remain.
    await waitFor(() => {
      expect(screen.queryByText('Gadget B')).not.toBeInTheDocument()
    })
    for (const title of ['Gadget A', 'Gadget C', 'Gadget D', 'Gadget E']) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }

    // The persisted layout must have exactly four gadgets and no B.
    const layout = readLayout()
    expect(layout.gadgets).toHaveLength(4)
    expect(layout.gadgets.some((g) => g.id === 'g2')).toBe(false)

    // Orders are contiguous 0..3 (no gaps in the ordering sequence).
    const orders = layout.gadgets.map((g) => g.order).sort((a, b) => a - b)
    expect(orders).toEqual([0, 1, 2, 3])

    // And the grid is completely filled: no interior holes and no trailing gap.
    const { holes, trailingGap } = analyzeLayout(layout.gadgets)
    expect(holes).toBe(0)
    expect(trailingGap).toBe(0)
  })

  it('reflows to a gap-free layout when a widget is removed from a single-row grid', async () => {
    // Three small widgets fill one row exactly. Removing one leaves a 1-col hole
    // unless the remaining widgets reflow.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        title: 'Dashboard',
        gadgets: [
          { id: 'a', type: 'bar', title: 'One', size: 'small', config: {}, order: 0 },
          { id: 'b', type: 'bar', title: 'Two', size: 'small', config: {}, order: 1 },
          { id: 'c', type: 'bar', title: 'Three', size: 'small', config: {}, order: 2 },
        ],
      }),
    )

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Two')).toBeInTheDocument()
    fireEvent.click(screen.getAllByTitle('Remove')[1])

    await waitFor(() => {
      expect(screen.queryByText('Two')).not.toBeInTheDocument()
    })

    const layout = readLayout()
    expect(layout.gadgets).toHaveLength(2)
    const { holes, trailingGap } = analyzeLayout(layout.gadgets)
    expect(holes).toBe(0)
    expect(trailingGap).toBe(0)
  })
})
