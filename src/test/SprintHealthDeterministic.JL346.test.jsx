import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SprintHealthGadget } from '../components/dashboard/gadgets/SprintHealthGadget'
import { fetchBurndown } from '../api/dashboardApi'

// JL-346: the Sprint Burndown gadget used to build its "Actual" line with
// Math.random() in the component body — unmemoised and unseeded — so the chart
// silently redrew to a different shape on every re-render, and the numbers were
// invented in the first place. The gadget now plots the real
// GET /api/reports/burndown series for a sprint.
//
// These tests are written so they also RUN against the old implementation
// (which took only `issues` and rendered synchronously): the actual series is
// located by its stroke colour, which both versions use. Against the old code
// the determinism assertions fail because the random walk differs per render.

vi.mock('../api/dashboardApi', () => ({
  fetchBurndown: vi.fn(),
}))

// A deterministic server response: 10 sprint days, remaining burning down.
const DAYS = [
  { date: '2026-07-01', ideal: 20, remaining: 20 },
  { date: '2026-07-02', ideal: 17.78, remaining: 20 },
  { date: '2026-07-03', ideal: 15.56, remaining: 18 },
  { date: '2026-07-04', ideal: 13.33, remaining: 17 },
  { date: '2026-07-05', ideal: 11.11, remaining: 14 },
  { date: '2026-07-06', ideal: 8.89, remaining: 14 },
  { date: '2026-07-07', ideal: 6.67, remaining: 11 },
  { date: '2026-07-08', ideal: 4.44, remaining: 9 },
  { date: '2026-07-09', ideal: 2.22, remaining: 9 },
  { date: '2026-07-10', ideal: 0, remaining: 8 },
]
const BURNDOWN = { sprintId: 7, unit: 'count', committedPoints: 20, days: DAYS }

// Only consumed by the pre-fix implementation, which derived its fake series
// from these. Kept so the test exercises the old code path too.
const ISSUES = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  status: i < 12 ? 'Done' : 'To Do',
}))

// The actual (measured) series. Selected by stroke colour rather than test id
// so the assertion is valid against the pre-fix component as well.
const ACTUAL_SELECTOR = 'polyline[stroke="#0052cc"]'

function actualPoints(container) {
  const line = container.querySelector(ACTUAL_SELECTOR)
  return line ? line.getAttribute('points') : null
}

async function renderGadget() {
  const view = render(<SprintHealthGadget issues={ISSUES} sprintId={7} config={{ unit: 'count' }} />)
  await waitFor(() => expect(actualPoints(view.container)).toBeTruthy())
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchBurndown.mockResolvedValue(BURNDOWN)
})

describe('JL-346: Sprint Burndown gadget renders a deterministic series', () => {
  it('produces a byte-identical actual polyline across repeated independent renders', async () => {
    // Rendered many times on purpose: a single comparison could pass by luck
    // against the random implementation, eight independent renders cannot.
    const seen = new Set()
    for (let i = 0; i < 8; i++) {
      const view = await renderGadget()
      seen.add(actualPoints(view.container))
      view.unmount()
    }
    expect(seen.size).toBe(1)
  })

  it('does not alter the series when the parent re-renders', async () => {
    function Parent() {
      const [tick, setTick] = useState(0)
      return (
        <div>
          <button onClick={() => setTick((t) => t + 1)}>bump</button>
          <span data-testid="tick">{tick}</span>
          <SprintHealthGadget issues={ISSUES} sprintId={7} config={{ unit: 'count' }} />
        </div>
      )
    }

    const { container } = render(<Parent />)
    await waitFor(() => expect(actualPoints(container)).toBeTruthy())
    const first = actualPoints(container)

    // Six unrelated parent state changes — each one re-ran the old random walk.
    const seen = new Set([first])
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByText('bump'))
      await waitFor(() => expect(screen.getByTestId('tick')).toHaveTextContent(String(i + 1)))
      seen.add(actualPoints(container))
    }
    expect(seen.size).toBe(1)
    expect(actualPoints(container)).toBe(first)
  })

  it('re-rendering with identical props via rerender() keeps the exact same points', async () => {
    const view = await renderGadget()
    const first = actualPoints(view.container)
    const seen = new Set([first])
    for (let i = 0; i < 6; i++) {
      view.rerender(<SprintHealthGadget issues={ISSUES} sprintId={7} config={{ unit: 'count' }} />)
      seen.add(actualPoints(view.container))
    }
    expect(seen.size).toBe(1)
  })
})

describe('JL-346: the series comes from the burndown API, not from Math.random()', () => {
  it('requests the sprint burndown and plots one point per returned day', async () => {
    const { container } = await renderGadget()
    expect(fetchBurndown).toHaveBeenCalledWith(7, 'count')
    expect(container.querySelectorAll('circle')).toHaveLength(DAYS.length)
    expect(actualPoints(container).split(' ')).toHaveLength(DAYS.length)
  })

  it('plots the remaining values returned by the API', async () => {
    const { container } = await renderGadget()
    // Each data point carries an SVG <title> with the API's own remaining value.
    const tooltips = Array.from(container.querySelectorAll('circle > title')).map((t) => t.textContent)
    expect(tooltips).toEqual(DAYS.map((d) => `${d.date}: ${d.remaining} remaining`))
    // committed (20) - final remaining (8) = 12 completed
    expect(screen.getByText('12/20 completed')).toBeInTheDocument()
  })

  it('refetches when the sprint changes and stays stable afterwards', async () => {
    const other = {
      ...BURNDOWN,
      sprintId: 9,
      committedPoints: 10,
      days: DAYS.slice(0, 5).map((d) => ({ ...d, remaining: d.remaining / 2, ideal: d.ideal / 2 })),
    }
    const view = await renderGadget()
    const first = actualPoints(view.container)

    fetchBurndown.mockResolvedValue(other)
    view.rerender(<SprintHealthGadget issues={ISSUES} sprintId={9} config={{ unit: 'count' }} />)
    await waitFor(() => expect(actualPoints(view.container)).not.toBe(first))

    const second = actualPoints(view.container)
    view.rerender(<SprintHealthGadget issues={ISSUES} sprintId={9} config={{ unit: 'count' }} />)
    expect(actualPoints(view.container)).toBe(second)
  })
})

describe('JL-346: loading and no-sprint states', () => {
  it('shows a loading state while the burndown request is in flight', async () => {
    let resolveFetch
    fetchBurndown.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve }))

    const { container } = render(<SprintHealthGadget issues={ISSUES} sprintId={7} config={{}} />)
    expect(screen.getByText(/loading burndown/i)).toBeInTheDocument()
    expect(container.querySelector(ACTUAL_SELECTOR)).toBeNull()

    resolveFetch(BURNDOWN)
    await waitFor(() => expect(container.querySelector(ACTUAL_SELECTOR)).toBeTruthy())
    expect(screen.queryByText(/loading burndown/i)).toBeNull()
  })

  it('shows a no-sprint state (and skips the request) when there is no sprint id', async () => {
    const { container } = render(<SprintHealthGadget issues={ISSUES} sprintId={null} config={{}} />)
    expect(screen.getByText(/no active sprint/i)).toBeInTheDocument()
    expect(container.querySelector(ACTUAL_SELECTOR)).toBeNull()
    expect(fetchBurndown).not.toHaveBeenCalled()
  })

  it('surfaces an error instead of inventing a series when the request fails', async () => {
    fetchBurndown.mockRejectedValue(new Error('Sprint not found'))
    const { container } = render(<SprintHealthGadget issues={ISSUES} sprintId={7} config={{}} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sprint not found'))
    expect(container.querySelector(ACTUAL_SELECTOR)).toBeNull()
  })

  it('shows an empty state when the sprint has no burndown days', async () => {
    fetchBurndown.mockResolvedValue({ sprintId: 7, unit: 'count', committedPoints: 0, days: [] })
    const { container } = render(<SprintHealthGadget issues={ISSUES} sprintId={7} config={{}} />)
    await waitFor(() => expect(screen.getByText(/no burndown data/i)).toBeInTheDocument())
    expect(container.querySelector(ACTUAL_SELECTOR)).toBeNull()
  })
})
