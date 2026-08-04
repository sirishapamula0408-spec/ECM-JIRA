import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DonutChartGadget } from '../components/dashboard/gadgets/DonutChartGadget'
import { PieChartGadget } from '../components/dashboard/gadgets/PieChartGadget'
// ?raw hands us the stylesheet as a string, so the hole geometry can be asserted
// against the CSS that actually ships (no fs/process, which the frontend ESLint
// config rightly forbids).
import dashboardCss from '../pages/DashboardPage/DashboardPage.css?raw'

/* ================================================================
   JL-335 — the donut's "%" labels were clipped by the centre hole.

   Geometry (all in viewBox user units; the disc is 140px against a
   160-unit viewBox, so 1 unit = 0.875px):
     .donut-hole is inset 30px  -> hole radius 40px = 45.7 units
     ring outer edge is 70px    ->                    80   units
   Labels were hard-coded at radius 60 against a then-24px inset (hole
   radius 52.6). Near 3 and 9 o'clock a label's WIDTH points radially,
   so "25%" reached ~47 units — inside the hole — and the opaque hole,
   stacked above the SVG, painted over the digits.
   ================================================================ */

const CENTRE = 80
const HOLE_RADIUS = 45.7
const RING_OUTER_RADIUS = 80
// Half-width of a rendered "25%" label, measured in Chromium via getBBox:
// 26.4 user units wide, plus the 2.5-unit outline from .pie-gadget-slice-label
// (paint-order:stroke extends 1.25 beyond the glyphs on each side).
// jsdom has no text metrics, so the measured worst case is asserted here.
const LABEL_HALF_WIDTH = (26.4 + 2.5) / 2

// Four roughly equal slices put labels near 12, 3, 6 and 9 o'clock — the
// 3 and 9 o'clock ones are exactly where the old radius clipped.
const FOUR_WAY = [
  { id: 1, status: 'To Do' },
  { id: 2, status: 'In Progress' },
  { id: 3, status: 'Done' },
  { id: 4, status: 'Code Review' },
]

function labelPositions(container) {
  return [...container.querySelectorAll('text.pie-gadget-slice-label')].map((t) => ({
    text: t.textContent,
    x: Number(t.getAttribute('x')),
    y: Number(t.getAttribute('y')),
    radius: Math.hypot(Number(t.getAttribute('x')) - CENTRE, Number(t.getAttribute('y')) - CENTRE),
  }))
}

describe('JL-335 — donut percentage labels are not clipped by the centre hole', () => {
  it('renders a label for every slice', () => {
    const { container } = render(
      <DonutChartGadget issues={FOUR_WAY} config={{ groupBy: 'status', showLabels: true }} />,
    )
    const labels = labelPositions(container)
    expect(labels).toHaveLength(4)
    labels.forEach((l) => expect(l.text).toMatch(/^\d+%$/))
  })

  it('places every label on the visible ring band, not on the hole edge', () => {
    const { container } = render(
      <DonutChartGadget issues={FOUR_WAY} config={{ groupBy: 'status', showLabels: true }} />,
    )
    const labels = labelPositions(container)
    expect(labels.length).toBeGreaterThan(0)

    const bandMidpoint = (HOLE_RADIUS + RING_OUTER_RADIUS) / 2
    labels.forEach((l) => {
      // Centred on the band (the regression: this used to be 60).
      expect(l.radius).toBeCloseTo(bandMidpoint, 1)
      expect(l.radius).toBeGreaterThan(60)
    })
  })

  it('keeps the full label width clear of the hole even where width points radially', () => {
    const { container } = render(
      <DonutChartGadget issues={FOUR_WAY} config={{ groupBy: 'status', showLabels: true }} />,
    )
    labelPositions(container).forEach((l) => {
      // Inner edge must stay outside the hole — this is exactly what failed before.
      expect(l.radius - LABEL_HALF_WIDTH).toBeGreaterThan(HOLE_RADIUS)
      // ...and the outer edge must stay inside the ring so nothing is cut off there either.
      expect(l.radius + LABEL_HALF_WIDTH).toBeLessThanOrEqual(RING_OUTER_RADIUS)
    })
  })

  it('still hides labels on slivers too narrow to hold one', () => {
    const lopsided = [
      ...Array.from({ length: 40 }, (_, i) => ({ id: i + 100, status: 'To Do' })),
      { id: 1, status: 'Done' },
    ]
    const { container } = render(
      <DonutChartGadget issues={lopsided} config={{ groupBy: 'status', showLabels: true }} />,
    )
    // The 1-of-41 slice sweeps under 18 degrees, so only the dominant slice is labelled.
    expect(container.querySelectorAll('text.pie-gadget-slice-label')).toHaveLength(1)
  })

  it('honours showLabels:false', () => {
    const { container } = render(
      <DonutChartGadget issues={FOUR_WAY} config={{ groupBy: 'status', showLabels: false }} />,
    )
    expect(container.querySelectorAll('text.pie-gadget-slice-label')).toHaveLength(0)
  })

  it('leaves the centre total readout intact', () => {
    const { container, getByText } = render(
      <DonutChartGadget issues={FOUR_WAY} config={{ groupBy: 'status', showLabels: true }} />,
    )
    expect(container.querySelector('.donut-hole')).toBeTruthy()
    expect(getByText('4')).toBeTruthy()
    expect(getByText('Total')).toBeTruthy()
  })

  it('does not disturb the JL-318 hover fix', () => {
    const { container } = render(
      <DonutChartGadget issues={FOUR_WAY} config={{ groupBy: 'status', showLabels: true }} />,
    )
    expect(container.querySelector('.donut-hole')).toHaveStyle({ pointerEvents: 'none' })
  })

  it('keeps the CSS hole inset in sync with the radius the label maths assumes', () => {
    // The label radius is derived from HOLE_RADIUS in DonutChartGadget.jsx, but the
    // hole itself is sized by CSS. If someone retunes the inset without updating the
    // constant, labels silently drift back onto the hole — so pin the pair here.
    const holeBlock = dashboardCss.slice(dashboardCss.indexOf('.donut-hole {'))
    const inset = Number(/inset:\s*(\d+)px/.exec(holeBlock)?.[1])
    expect(inset).toBeGreaterThan(0)

    // disc is 140px wide against a 160-unit viewBox => 1px = 160/140 units
    const discRadiusPx = 70
    const expectedHoleRadius = ((discRadiusPx - inset) * 160) / 140
    expect(expectedHoleRadius).toBeCloseTo(HOLE_RADIUS, 1)

    // ...and the band must actually be wide enough to hold a label.
    expect(RING_OUTER_RADIUS - expectedHoleRadius).toBeGreaterThan(LABEL_HALF_WIDTH * 2)
  })

  it('leaves the pie gadget placement alone — it has no hole to clip against', () => {
    const { container } = render(
      <PieChartGadget issues={FOUR_WAY} config={{ groupBy: 'status', showLabels: true }} />,
    )
    const labels = labelPositions(container)
    expect(labels.length).toBeGreaterThan(0)
    labels.forEach((l) => expect(l.radius).toBeCloseTo(50, 1))
  })
})
