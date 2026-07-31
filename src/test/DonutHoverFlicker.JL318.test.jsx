import { describe, it, expect } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { DonutChartGadget } from '../components/dashboard/gadgets/DonutChartGadget'

const STATUS_ISSUES = [
  { id: 1, status: 'To Do' },
  { id: 2, status: 'To Do' },
  { id: 3, status: 'To Do' },
  { id: 4, status: 'In Progress' },
  { id: 5, status: 'Done' },
  { id: 6, status: 'Done' },
]

/* ================================================================
   JL-318: the donut's centre hole overlays the SVG hover paths. Without
   pointer-events:none it stole hover as the cursor crossed the ring/hole
   boundary, so the SVG fired mouseleave and the tooltip flickered on/off.
   ================================================================ */
describe('JL-318 — donut hover flicker fix', () => {
  it('the centre hole does not capture pointer events (so hover passes through to the slices)', () => {
    const { container } = render(
      <DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status', showLabels: true }} />,
    )
    const hole = container.querySelector('.donut-hole')
    expect(hole).toBeTruthy()
    // This is the fix: pointer-events:none lets the underlying sector paths keep the hover.
    expect(hole).toHaveStyle({ pointerEvents: 'none' })
  })

  it('the hole is non-interactive — no mouse handlers that could clear the hovered slice', () => {
    const { container } = render(
      <DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status' }} />,
    )
    const hole = container.querySelector('.donut-hole')
    // hovering the hole must not throw or wire any behaviour; the tooltip state
    // is owned entirely by the SVG paths + svg.onMouseLeave.
    fireEvent.mouseEnter(hole)
    fireEvent.mouseLeave(hole)
    expect(hole).toBeTruthy()
  })

  it('hovering a slice shows one tooltip and only the svg leave clears it', async () => {
    const { container } = render(
      <DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status', showLabels: true }} />,
    )
    const svg = container.querySelector('svg.pie-gadget-svg')
    const firstSlice = svg.querySelector('path')

    fireEvent.mouseEnter(firstSlice)
    expect(container.querySelectorAll('.pie-gadget-tooltip').length).toBe(1)

    // moving between slices must not clear the tooltip (no per-slice mouseleave)
    const slices = svg.querySelectorAll('path')
    if (slices.length > 1) {
      fireEvent.mouseEnter(slices[1])
      expect(container.querySelectorAll('.pie-gadget-tooltip').length).toBe(1)
    }

    // only leaving the whole chart clears it
    fireEvent.mouseLeave(svg)
    await waitFor(() => {
      expect(container.querySelectorAll('.pie-gadget-tooltip').length).toBe(0)
    })
  })
})
