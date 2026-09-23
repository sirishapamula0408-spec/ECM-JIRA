/* ================================================================
   JL-471 — the chart legend shows a count, not "count (percent)".

   The legend row read "Backlog  1 (13%)". Two problems:

     • it duplicated the "%" label already drawn on the segment itself;
     • it used a DIFFERENT denominator. The on-slice label is a share
       of the currently VISIBLE slices; the legend was a share of the
       grand total. Hide a slice and the two numbers on screen for the
       same segment disagreed.

   What must NOT change: the percentage labels drawn on the donut
   segments, and the donut's centre readout.
   ================================================================ */
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DonutChartGadget } from '../components/dashboard/gadgets/DonutChartGadget'
import { PieChartGadget } from '../components/dashboard/gadgets/PieChartGadget'

// 1 / 2 / 5 out of 8 — deliberately uneven, so a percentage would be visible
// and non-round if one were still being rendered.
const ISSUES = [
  { id: 1, status: 'Backlog' },
  { id: 2, status: 'To Do' },
  { id: 3, status: 'To Do' },
  { id: 4, status: 'In Progress' },
  { id: 5, status: 'In Progress' },
  { id: 6, status: 'In Progress' },
  { id: 7, status: 'In Progress' },
  { id: 8, status: 'In Progress' },
]

const renderGadget = (ui) => render(ui, { wrapper: MemoryRouter })

const legendRows = (container) =>
  [...container.querySelectorAll('.pie-gadget-legend li')].map((li) => ({
    label: li.querySelector('.legend-label').textContent,
    count: li.querySelector('strong')?.textContent ?? null,
    text: li.textContent,
  }))

for (const [name, Gadget] of Object.entries({ donut: DonutChartGadget, pie: PieChartGadget })) {
  describe(`JL-471 — ${name} legend shows the count alone`, () => {
    it('renders the bare count, with no bracketed percentage', () => {
      const { container } = renderGadget(<Gadget issues={ISSUES} config={{ groupBy: 'status' }} />)
      expect(legendRows(container)).toEqual([
        { label: 'Backlog', count: '1', text: 'Backlog1' },
        { label: 'To Do', count: '2', text: 'To Do2' },
        { label: 'In Progress', count: '5', text: 'In Progress5' },
      ])
    })

    it('has no "%" anywhere in the legend', () => {
      const { container } = renderGadget(<Gadget issues={ISSUES} config={{ groupBy: 'status' }} />)
      expect(container.querySelector('.pie-gadget-legend').textContent).not.toContain('%')
    })

    it('keeps the count in its own <strong>, so it can be right-aligned as a column', () => {
      const { container } = renderGadget(<Gadget issues={ISSUES} config={{ groupBy: 'status' }} />)
      for (const li of container.querySelectorAll('.pie-gadget-legend li')) {
        const strong = li.querySelector('strong')
        expect(strong).toBeTruthy()
        // Exactly the number — nothing else may share the slot, or the right
        // edges stop lining up.
        expect(strong.textContent).toMatch(/^\d+$/)
        expect(strong).toBe(li.lastElementChild)
      }
    })

    it('still honours showLabels:false by dropping the count entirely', () => {
      const { container } = renderGadget(
        <Gadget issues={ISSUES} config={{ groupBy: 'status', showLabels: false }} />,
      )
      for (const li of container.querySelectorAll('.pie-gadget-legend li')) {
        expect(li.querySelector('strong')).toBeNull()
      }
    })

    it('does not reintroduce a percentage when a slice is hidden', () => {
      const { container } = renderGadget(<Gadget issues={ISSUES} config={{ groupBy: 'status' }} />)
      fireEvent.click(container.querySelector('.legend-dot-btn'))
      expect(container.querySelector('.pie-gadget-legend').textContent).not.toContain('%')
      // The count is the segment's own count, unaffected by what is hidden.
      expect(legendRows(container).map((r) => r.count)).toEqual(['1', '2', '5'])
    })
  })
}

describe('JL-471 — the donut itself is untouched', () => {
  it('still draws a percentage label on each segment', () => {
    const { container } = renderGadget(<DonutChartGadget issues={ISSUES} config={{ groupBy: 'status' }} />)
    const sliceLabels = [...container.querySelectorAll('.pie-gadget-slice-label')].map((n) => n.textContent)
    expect(sliceLabels.length).toBeGreaterThan(0)
    for (const label of sliceLabels) expect(label).toMatch(/^\d+%$/)
  })

  it('those on-slice labels are a share of the VISIBLE slices, and still re-compute', () => {
    const { container } = renderGadget(<DonutChartGadget issues={ISSUES} config={{ groupBy: 'status' }} />)
    const before = [...container.querySelectorAll('.pie-gadget-slice-label')].map((n) => n.textContent)
    // 1/8, 2/8, 5/8. The smallest is 45° of sweep, comfortably over the 18°
    // threshold below which a label is suppressed, so all three are drawn.
    expect(before).toEqual(['13%', '25%', '63%'])

    // Hide Backlog: the remaining two are now 2/7 and 5/7.
    fireEvent.click(container.querySelector('.legend-dot-btn'))
    const after = [...container.querySelectorAll('.pie-gadget-slice-label')].map((n) => n.textContent)
    expect(after).toEqual(['29%', '71%'])
  })

  it('keeps the centre readout on the grand total', () => {
    const { container } = renderGadget(<DonutChartGadget issues={ISSUES} config={{ groupBy: 'status' }} />)
    expect(container.querySelector('.donut-hole strong').textContent).toBe('8')
    fireEvent.click(container.querySelector('.legend-dot-btn'))
    expect(container.querySelector('.donut-hole strong').textContent).toBe('8')
  })
})
