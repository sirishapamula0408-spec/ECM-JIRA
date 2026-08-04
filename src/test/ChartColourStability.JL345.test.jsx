/* ================================================================
   JL-345 — pie/donut chart colour stability + empty states.

   Two defects, both visible on the dashboard's pie and donut gadgets:

   1. LEGEND/DISC COLOUR DESYNC. The gadgets coloured their *filtered*
      segment list by array index, while the legend coloured the
      *unfiltered* list by array index. getColor() falls back to
      FALLBACK_COLORS[index % n] whenever the grouping has no named
      palette entry, so hiding one legend item shifted every later
      index by one: the disc repainted itself in colours the legend no
      longer matched, and every still-visible slice changed colour for
      no reason the user asked for. groupBy:'assignee' is the worst
      case — its palette is literally {}, so EVERY colour comes from
      the index fallback.

   2. NO EMPTY STATE. With zero issues both gadgets rendered a blank
      grey disc and an empty legend with no explanation, while every
      sibling gadget handles it (BarChartGadget, FilterResultsGadget,
      ActivityStreamGadget).

   The invariant these tests pin down: a label's colour is a function of
   its position in the UNFILTERED grouping, and therefore must not
   depend on what is currently hidden.
   ================================================================ */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PieChartGadget } from '../components/dashboard/gadgets/PieChartGadget'
import { DonutChartGadget } from '../components/dashboard/gadgets/DonutChartGadget'

// JL-336: the legend renders <Link>s into the issue list, so the gadgets need
// router context even when rendered standalone.
const renderGadget = (ui) => render(ui, { wrapper: MemoryRouter })

// Four assignee buckets, deliberately uneven so the slices are distinguishable.
// groupIssuesBy() preserves first-seen order: Alice, Bob, Cara, Dan.
const ASSIGNEE_ISSUES = [
  { id: 1, assignee: 'Alice', status: 'To Do' },
  { id: 2, assignee: 'Alice', status: 'Done' },
  { id: 3, assignee: 'Bob', status: 'To Do' },
  { id: 4, assignee: 'Cara', status: 'In Progress' },
  { id: 5, assignee: 'Cara', status: 'Done' },
  { id: 6, assignee: 'Dan', status: 'Done' },
]

// Both gadgets carry the identical bug and the identical fix, so every
// behaviour below is asserted against both.
const GADGETS = { pie: PieChartGadget, donut: DonutChartGadget }

const dotFor = (label) => screen.getByRole('button', { name: new RegExp(`${label} slice`) })

// The disc is painted with a single conic-gradient, so its colour stops ARE the
// slice fills, in visible-slice order. jsdom normalises the hexes to rgb().
function discColours(container) {
  const bg = container.querySelector('.pie-gadget-disc').style.background
  return [...bg.matchAll(/rgb\([^)]*\)/g)].map((m) => m[0])
}

// label -> the colour its legend dot is painted, for entries that are not hidden.
function legendColours(container) {
  const out = {}
  for (const li of container.querySelectorAll('.pie-gadget-legend li')) {
    const label = li.querySelector('.legend-label').textContent
    if (li.classList.contains('legend-hidden')) continue
    out[label] = li.querySelector('.legend-dot').style.background
  }
  return out
}

for (const gadgetName of Object.keys(GADGETS)) {
const Gadget = GADGETS[gadgetName]

describe(`JL-345 — ${gadgetName} gadget keeps slice colours stable when a slice is hidden`, () => {
  it('leaves every remaining slice on its original colour after hiding the FIRST legend item', () => {
    const { container } = renderGadget(
      <Gadget issues={ASSIGNEE_ISSUES} config={{ groupBy: 'assignee' }} />,
    )

    const before = discColours(container)
    expect(before).toHaveLength(4) // Alice, Bob, Cara, Dan
    expect(new Set(before).size).toBe(4) // ...and four distinct colours

    fireEvent.click(dotFor('Alice'))

    // Alice's stop disappears; Bob/Cara/Dan must keep the exact fills they had.
    // Before the fix these re-indexed to 0,1,2 and took Alice/Bob/Cara's colours.
    expect(discColours(container)).toEqual(before.slice(1))
  })

  it('leaves every remaining slice on its original colour after hiding a MIDDLE legend item', () => {
    const { container } = renderGadget(
      <Gadget issues={ASSIGNEE_ISSUES} config={{ groupBy: 'assignee' }} />,
    )
    const before = discColours(container)

    fireEvent.click(dotFor('Bob'))

    expect(discColours(container)).toEqual([before[0], before[2], before[3]])
  })

  it('keeps the disc and the legend agreeing on every visible label', () => {
    const { container } = renderGadget(
      <Gadget issues={ASSIGNEE_ISSUES} config={{ groupBy: 'assignee' }} />,
    )

    // Visible slices are the unfiltered order minus the hidden ones, so the
    // gradient stops line up 1:1 with the non-hidden legend rows.
    const check = () => {
      const visibleLabels = [...container.querySelectorAll('.pie-gadget-legend li')]
        .filter((li) => !li.classList.contains('legend-hidden'))
        .map((li) => li.querySelector('.legend-label').textContent)
      const legend = legendColours(container)
      const disc = discColours(container)
      expect(disc).toHaveLength(visibleLabels.length)
      visibleLabels.forEach((label, i) => {
        expect(disc[i]).toBe(legend[label])
      })
    }

    check()
    fireEvent.click(dotFor('Alice'))
    check()
    fireEvent.click(dotFor('Cara'))
    check()
  })

  it('restores the original colours when the hidden slice is shown again', () => {
    const { container } = renderGadget(
      <Gadget issues={ASSIGNEE_ISSUES} config={{ groupBy: 'assignee' }} />,
    )
    const before = discColours(container)
    const legendBefore = legendColours(container)

    fireEvent.click(dotFor('Alice'))
    fireEvent.click(dotFor('Alice'))

    expect(discColours(container)).toEqual(before)
    expect(legendColours(container)).toEqual(legendBefore)
  })

  it('holds for a named palette too — hiding a status does not recolour the rest', () => {
    // 'status' has a full palette so index never comes into it, but the
    // guarantee is the same one and it must not regress either.
    const { container } = renderGadget(
      <Gadget issues={ASSIGNEE_ISSUES} config={{ groupBy: 'status' }} />,
    )
    const before = discColours(container)
    const legendBefore = legendColours(container)

    fireEvent.click(dotFor('To Do'))

    expect(discColours(container)).toEqual(before.slice(1))
    const legendAfter = legendColours(container)
    for (const label of Object.keys(legendAfter)) {
      expect(legendAfter[label]).toBe(legendBefore[label])
    }
  })
})

describe(`JL-345 — ${gadgetName} gadget renders an empty state with no data`, () => {
  it('shows the same "No data available" message its sibling gadgets use', () => {
    renderGadget(<Gadget issues={[]} config={{ groupBy: 'status' }} />)
    // Wording matches BarChartGadget so the dashboard reads consistently.
    expect(screen.getByText('No data available')).toBeTruthy()
  })

  it('renders no blank grey disc and no empty legend', () => {
    const { container } = renderGadget(<Gadget issues={[]} config={{ groupBy: 'status' }} />)
    expect(container.querySelector('.pie-gadget-disc')).toBeNull()
    expect(container.querySelector('.pie-gadget-legend')).toBeNull()
  })

  it('applies the empty state whatever the grouping', () => {
    renderGadget(<Gadget issues={[]} config={{ groupBy: 'assignee' }} />)
    expect(screen.getByText('No data available')).toBeTruthy()
  })
})

describe(`JL-345 — ${gadgetName} gadget distinguishes "everything hidden" from "no data"`, () => {
  const hideAll = () => {
    for (const label of ['Alice', 'Bob', 'Cara', 'Dan']) fireEvent.click(dotFor(label))
  }

  it('does not claim there is no data — the data exists, the user hid it', () => {
    const { container } = renderGadget(
      <Gadget issues={ASSIGNEE_ISSUES} config={{ groupBy: 'assignee' }} />,
    )
    hideAll()

    expect(screen.queryByText('No data available')).toBeNull()
    expect(screen.getByText('All slices hidden')).toBeTruthy()
    // The disc stays (blank/grey) rather than collapsing the layout.
    expect(container.querySelector('.pie-gadget-disc')).toBeTruthy()
  })

  it('keeps the legend rendered so the user can undo it — hiding everything is not a dead end', () => {
    const { container } = renderGadget(
      <Gadget issues={ASSIGNEE_ISSUES} config={{ groupBy: 'assignee' }} />,
    )
    const before = discColours(container)
    hideAll()

    const legend = container.querySelector('.pie-gadget-legend')
    expect(legend).toBeTruthy()
    expect(within(legend).getAllByRole('button')).toHaveLength(4)

    // ...and unwinding it brings back exactly the colours we started with.
    for (const label of ['Alice', 'Bob', 'Cara', 'Dan']) fireEvent.click(dotFor(label))
    expect(screen.queryByText('All slices hidden')).toBeNull()
    expect(discColours(container)).toEqual(before)
  })
})

} // end per-gadget suites

describe('JL-345 — donut specifics', () => {
  it('the centre readout keeps showing the real total while slices are hidden', () => {
    const { container } = renderGadget(
      <DonutChartGadget issues={ASSIGNEE_ISSUES} config={{ groupBy: 'assignee' }} />,
    )
    const hole = container.querySelector('.donut-hole')
    expect(hole.querySelector('strong').textContent).toBe('6')

    fireEvent.click(dotFor('Alice'))
    // Still 6: the legend percentages are "share of everything" (JL-336), and
    // the hole must agree with them, not with the visible subset.
    expect(container.querySelector('.donut-hole strong').textContent).toBe('6')
  })

  it('has no hole to render at all in the empty state', () => {
    const { container } = renderGadget(<DonutChartGadget issues={[]} config={{ groupBy: 'status' }} />)
    expect(container.querySelector('.donut-hole')).toBeNull()
  })
})
