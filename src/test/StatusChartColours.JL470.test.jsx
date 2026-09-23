/* ================================================================
   JL-470 — every status gets its own donut colour.

   JL-457 routed a status through resolveStatusCategory() and painted
   the CATEGORY accent token. Right for a lozenge, where the text
   already names the status; wrong for a chart segment, where colour is
   the only identity a slice has. Five statuses collapsed onto three
   categories:

     Backlog     -> todo       -> #8993a4
     To Do       -> todo       -> #8993a4   <- same grey
     In Progress -> inprogress -> #0052cc
     Code Review -> inprogress -> #0052cc   <- same blue
     Done        -> done       -> #00875a

   Four slices, two colours. The invariants pinned down here:

     • distinct colour per status, from ONE exported constant;
     • the donut segment and its legend swatch read that same value;
     • an unmapped status gets a documented sixth colour rather than
       silently impersonating one of the five.
   ================================================================ */
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  STATUS_COLORS,
  STATUS_FALLBACK_COLOR,
  getColor,
  resolveSegmentColors,
} from '../components/dashboard/gadgets/gadgetChartUtils'
import { DonutChartGadget } from '../components/dashboard/gadgets/DonutChartGadget'
import { PieChartGadget } from '../components/dashboard/gadgets/PieChartGadget'
import { ISSUE_STATUSES } from '../constants'

// One issue per status, so every slice exists and the counts are distinguishable.
const STATUS_ISSUES = [
  { id: 1, status: 'Backlog' },
  { id: 2, status: 'To Do' },
  { id: 3, status: 'To Do' },
  { id: 4, status: 'In Progress' },
  { id: 5, status: 'Code Review' },
  { id: 6, status: 'Done' },
]

const renderGadget = (ui) => render(ui, { wrapper: MemoryRouter })

// jsdom normalises hexes to rgb() inside a style attribute, so compare through
// the same normalisation rather than against the literal hex.
function asRgb(hex) {
  const el = document.createElement('div')
  el.style.color = hex
  return el.style.color
}

function discColours(container) {
  const bg = container.querySelector('.pie-gadget-disc').style.background
  return [...bg.matchAll(/rgb\([^)]*\)/g)].map((m) => m[0])
}

function legendColours(container) {
  const out = {}
  for (const li of container.querySelectorAll('.pie-gadget-legend li')) {
    out[li.querySelector('.legend-label').textContent] = li.querySelector('.legend-dot').style.background
  }
  return out
}

describe('JL-470 — STATUS_COLORS is the single mapping', () => {
  it('covers every status in the app-wide status vocabulary', () => {
    // ISSUE_STATUSES is NINE statuses, not the five the ticket named. Mapping
    // only five would send In Testing / In Rework / In UAT / Cancelled to the
    // single fallback — four slices sharing one colour, i.e. the reported bug
    // moved down the list. Adding a status without a colour must fail here.
    for (const status of ISSUE_STATUSES) {
      expect(STATUS_COLORS[status], `no colour mapped for "${status}"`).toBeTruthy()
    }
  })

  it('carries the agreed Atlassian values for the five named in the ticket', () => {
    expect(STATUS_COLORS).toMatchObject({
      'Backlog': '#8993A4',
      'To Do': '#6554C0',
      'In Progress': '#0052CC',
      'Code Review': '#FF991F',
      'Done': '#36B37E',
    })
  })

  it('assigns a DISTINCT colour to every status — the whole point of the ticket', () => {
    const values = Object.values(STATUS_COLORS).map((c) => c.toLowerCase())
    expect(new Set(values).size).toBe(values.length)
  })

  it('does not collide the two pairs that used to share a colour', () => {
    expect(STATUS_COLORS['Backlog']).not.toBe(STATUS_COLORS['To Do'])
    expect(STATUS_COLORS['In Progress']).not.toBe(STATUS_COLORS['Code Review'])
  })
})

describe('JL-470 — the fallback never impersonates a mapped status', () => {
  it('is distinct from all five mapped colours', () => {
    const mapped = Object.values(STATUS_COLORS).map((c) => c.toLowerCase())
    expect(mapped).not.toContain(STATUS_FALLBACK_COLOR.toLowerCase())
  })

  it('is what an unknown project-defined status resolves to', () => {
    // Pre-JL-470 "UAT" resolved through the category map and came back as
    // In Progress's exact blue.
    expect(getColor('status', 'UAT', 0)).toBe(STATUS_FALLBACK_COLOR)
    expect(getColor('status', 'Awaiting Sign-off', 3)).toBe(STATUS_FALLBACK_COLOR)
    expect(getColor('status', 'Unassigned', 1)).toBe(STATUS_FALLBACK_COLOR)
  })

  it('does not depend on the segment index — an unknown status is not index-coloured', () => {
    const atZero = getColor('status', 'UAT', 0)
    const atSeven = getColor('status', 'UAT', 7)
    expect(atZero).toBe(atSeven)
  })

  it('tolerates padding and non-string keys without falling into another status', () => {
    expect(getColor('status', '  Done  ', 0)).toBe(STATUS_COLORS['Done'])
    expect(getColor('status', null, 0)).toBe(STATUS_FALLBACK_COLOR)
    expect(getColor('status', undefined, 0)).toBe(STATUS_FALLBACK_COLOR)
  })
})

describe('JL-470 — resolveSegmentColors stamps the mapped value', () => {
  it('colours each segment from STATUS_COLORS, not from its position', () => {
    const segments = resolveSegmentColors(
      [{ label: 'Done', count: 1 }, { label: 'Backlog', count: 2 }],
      'status',
    )
    expect(segments[0].color).toBe(STATUS_COLORS['Done'])
    expect(segments[1].color).toBe(STATUS_COLORS['Backlog'])
  })
})

for (const [name, Gadget] of Object.entries({ donut: DonutChartGadget, pie: PieChartGadget })) {
  describe(`JL-470 — ${name} paints five distinguishable statuses`, () => {
    it('draws one colour per slice, all different', () => {
      const { container } = renderGadget(<Gadget issues={STATUS_ISSUES} config={{ groupBy: 'status' }} />)
      const colours = discColours(container)
      expect(colours).toHaveLength(5)
      expect(new Set(colours).size).toBe(5)
    })

    it('uses the same colour in the segment and in its legend swatch', () => {
      const { container } = renderGadget(<Gadget issues={STATUS_ISSUES} config={{ groupBy: 'status' }} />)
      const legend = legendColours(container)
      const disc = discColours(container)
      // groupIssuesBy preserves first-seen order, and nothing is hidden, so the
      // gradient stops line up 1:1 with the legend rows.
      const labels = [...container.querySelectorAll('.pie-gadget-legend .legend-label')].map((n) => n.textContent)
      labels.forEach((label, i) => {
        expect(disc[i]).toBe(legend[label])
        expect(legend[label]).toBe(asRgb(STATUS_COLORS[label]))
      })
    })

    it('keeps each status on its own colour after a slice is hidden (JL-345 still holds)', () => {
      const { container } = renderGadget(<Gadget issues={STATUS_ISSUES} config={{ groupBy: 'status' }} />)
      const before = legendColours(container)

      fireEvent.click(container.querySelector('.legend-dot-btn'))

      const after = legendColours(container)
      // The hidden row's dot greys out; every other row keeps its exact colour.
      const labels = Object.keys(after).slice(1)
      for (const label of labels) expect(after[label]).toBe(before[label])
    })

    it('gives an unmapped workflow status the fallback, not a neighbour’s colour', () => {
      const { container } = renderGadget(
        <Gadget
          issues={[...STATUS_ISSUES, { id: 7, status: 'UAT' }]}
          config={{ groupBy: 'status' }}
        />,
      )
      const legend = legendColours(container)
      expect(legend['UAT']).toBe(asRgb(STATUS_FALLBACK_COLOR))
      for (const status of Object.keys(STATUS_COLORS)) {
        expect(legend['UAT']).not.toBe(legend[status])
      }
    })
  })
}
