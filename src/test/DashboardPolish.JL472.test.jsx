/* ================================================================
   JL-472 — Dashboard beautification.

   A review of the four widget cards against Atlassian's design
   language, implemented after sign-off. The items that can be pinned
   down are pinned down here; the ones that cannot (does the shadow
   LOOK right) are left to the eye.

   Grouped by the review's own headings.
   ================================================================ */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FilterResultsGadget } from '../components/dashboard/gadgets/FilterResultsGadget'
import { ActivityStreamGadget } from '../components/dashboard/gadgets/ActivityStreamGadget'
import { GadgetWrapper } from '../components/dashboard/GadgetWrapper'

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8')
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '')

function cssRules(path) {
  const src = stripComments(read(path))
  return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, ' '),
    body: m[2],
  }))
}

const ruleFor = (rules, selector) => rules.find((r) => r.selector === selector)

const ISSUES = [
  { id: 1, key: 'ECM-1', title: 'Has everything', assignee: 'a@x.com', priority: 'High', status: 'In Progress', createdAt: '2026-04-05T10:00:00.000Z' },
  { id: 2, key: 'ECM-2', title: 'No priority', assignee: 'b@x.com', status: 'Done', createdAt: '2025-12-20T10:00:00.000Z' },
]

const renderGrid = (issues = ISSUES) =>
  render(
    <MemoryRouter>
      <FilterResultsGadget issues={issues} config={{}} />
    </MemoryRouter>,
  )

/* ────────────────────────────────────────────────────────────────
   Lozenges — Priority and Status
   ──────────────────────────────────────────────────────────────── */

describe('JL-472 — the Status column is a real lozenge', () => {
  it('renders the shared <StatusLozenge>, not a flat grey .pill', () => {
    const { container } = renderGrid()
    const statusCells = [...container.querySelectorAll('tbody tr')].map((r) => r.querySelectorAll('td')[4])
    for (const cell of statusCells) {
      expect(cell.querySelector('.status-lozenge')).toBeTruthy()
      // The generic pill said nothing: every status painted the same grey.
      expect(cell.querySelector('span.pill')).toBeNull()
    }
  })

  it('carries the status category, so the colour is not decorative', () => {
    const { container } = renderGrid()
    const rows = container.querySelectorAll('tbody tr')
    const first = rows[0].querySelectorAll('td')[4].querySelector('.status-lozenge')
    const second = rows[1].querySelectorAll('td')[4].querySelector('.status-lozenge')
    // Default sort is key asc: ECM-1 (In Progress) then ECM-2 (Done).
    expect(first.getAttribute('data-category')).toBe('inprogress')
    expect(second.getAttribute('data-category')).toBe('done')
  })

  it('is the read-only variant — a dashboard readout is not an edit surface', () => {
    const { container } = renderGrid()
    const cell = container.querySelectorAll('tbody tr')[0].querySelectorAll('td')[4]
    expect(cell.querySelector('.status-lozenge-readonly')).toBeTruthy()
    // No transition menu, so the grid gains no new focus targets.
    expect(cell.querySelector('button')).toBeNull()
  })

  it('names the issue in its accessible label, so the status is not ambiguous', () => {
    const { container } = renderGrid()
    const lozenge = container.querySelectorAll('tbody tr')[0].querySelectorAll('td')[4].querySelector('.status-lozenge')
    expect(lozenge.getAttribute('aria-label')).toBe('Status for ECM-1: In Progress')
  })
})

describe('JL-472 — Priority takes the lozenge shape and the em-dash fallback', () => {
  it('opts the priority pill into --lozenge so it matches the status beside it', () => {
    const { container } = renderGrid()
    const pill = container.querySelectorAll('tbody tr')[0].querySelectorAll('td')[3].querySelector('span')
    expect(pill.classList.contains('pill')).toBe(true)
    expect(pill.classList.contains('pill--lozenge')).toBe(true)
    expect(pill.classList.contains('pill-priority--high')).toBe(true)
  })

  it('renders an em dash, not an empty capsule, when an issue has no priority', () => {
    const { container } = renderGrid()
    const cell = container.querySelectorAll('tbody tr')[1].querySelectorAll('td')[3]
    expect(cell.textContent).toBe('—')
    // The bug: <span class="pill pill-priority pill-priority--"></span>.
    expect(cell.querySelector('span.pill')).toBeNull()
    expect(cell.innerHTML).not.toContain('pill-priority--"')
  })
})

describe('JL-472 — .pill itself is deliberately NOT reshaped', () => {
  const rules = cssRules('src/styles/shared.css')

  it('adds the lozenge treatment as an opt-in modifier', () => {
    const lozenge = ruleFor(rules, '.pill--lozenge')
    expect(lozenge).toBeTruthy()
    expect(lozenge.body).toMatch(/text-transform:\s*uppercase/)
    expect(lozenge.body).toMatch(/border-radius:\s*var\(--radius-sm\)/)
  })

  it('leaves the base .pill round and sentence-case — it also dresses label chips and counts', () => {
    const pill = ruleFor(rules, '.pill')
    expect(pill).toBeTruthy()
    expect(pill.body).toMatch(/border-radius:\s*999px/)
    // Uppercasing a user's own label text would be wrong.
    expect(pill.body).not.toMatch(/text-transform/)
  })
})

/* ────────────────────────────────────────────────────────────────
   Table row height and hover
   ──────────────────────────────────────────────────────────────── */

describe('JL-472 — table density and hover', () => {
  const rules = cssRules('src/styles/shared.css')

  it('gives the row enough height to read as an Atlassian table row', () => {
    const rule = rules.find(
      (r) => r.selector.includes('.table th') && r.selector.includes('.table td') && /padding:/.test(r.body),
    )
    const [, v, h] = rule.body.match(/padding:\s*(\d+)px (\d+)px/).map(Number)
    expect(v).toBeGreaterThanOrEqual(10)
    expect(h).toBeGreaterThanOrEqual(12)
  })

  it('hovers with a neutral token, not a hardcoded blue tint', () => {
    const hover = ruleFor(rules, '.table tbody tr:hover')
    expect(hover.body).toMatch(/var\(--jira-hover-overlay\)/)
    // #f2f7ff is blue; in this app blue means "selected".
    expect(hover.body).not.toMatch(/#[0-9a-f]{3,8}/i)
  })

  it('still has no zebra striping — Atlassian uses dividers and hover', () => {
    for (const rule of rules) {
      expect(rule.selector).not.toMatch(/nth-child\((odd|even|2n)/)
    }
  })
})

/* ────────────────────────────────────────────────────────────────
   Card chrome
   ──────────────────────────────────────────────────────────────── */

describe('JL-472 — gadget card chrome', () => {
  const rules = cssRules('src/components/dashboard/GadgetWrapper.css')
  const vars = read('src/styles/variables.css')

  it('defines the raised elevation and the radius scale as tokens', () => {
    expect(vars).toMatch(/--jira-shadow-raised:/)
    expect(vars).toMatch(/--radius-sm:\s*3px/)
    expect(vars).toMatch(/--radius-md:\s*6px/)
    expect(vars).toMatch(/--radius-lg:\s*8px/)
  })

  it('rests the card on the raised elevation, not the floating drop shadow', () => {
    const gadget = ruleFor(rules, '.gadget')
    expect(gadget.body).toMatch(/box-shadow:\s*var\(--jira-shadow-raised\)/)
    expect(gadget.body).not.toMatch(/--jira-shadow-soft/)
  })

  it('keeps the border — the dark theme sets box-shadow:none and relies on it', () => {
    const gadget = ruleFor(rules, '.gadget')
    expect(gadget.body).toMatch(/border:\s*1px solid var\(--jira-border\)/)
    const dark = cssRules('src/styles/theme.css').find((r) => r.selector === '.app-theme-dark .gadget')
    expect(dark.body).toMatch(/box-shadow:\s*none/)
  })

  it('uses the radius scale rather than four ad-hoc values', () => {
    expect(ruleFor(rules, '.gadget').body).toMatch(/border-radius:\s*var\(--radius-lg\)/)
    expect(ruleFor(rules, '.gadget-maximize-panel').body).toMatch(/border-radius:\s*var\(--radius-lg\)/)
    expect(ruleFor(rules, '.gadget-size-menu').body).toMatch(/border-radius:\s*var\(--radius-sm\)/)
    expect(ruleFor(rules, '.gadget-action-btn').body).toMatch(/border-radius:\s*var\(--radius-sm\)/)
  })

  it('tokenises the hover shadow that was a character-identical literal', () => {
    expect(ruleFor(rules, '.gadget:hover').body).toMatch(/var\(--jira-shadow-hover\)/)
  })

  it('leaves no raw hex on the header controls', () => {
    for (const selector of ['.gadget-drag-handle', '.gadget-type-icon', '.gadget-action-btn', '.gadget-action-btn:hover']) {
      const rule = ruleFor(rules, selector)
      expect(rule, `missing rule ${selector}`).toBeTruthy()
      expect(rule.body, `${selector} still has a raw hex`).not.toMatch(/:\s*#[0-9a-f]{3,8}/i)
    }
  })

  it('grows the action button past the old 26px target', () => {
    const btn = ruleFor(rules, '.gadget-action-btn')
    expect(btn.body).toMatch(/width:\s*28px/)
    expect(btn.body).toMatch(/height:\s*28px/)
  })

  it('honours prefers-reduced-motion', () => {
    expect(read('src/components/dashboard/GadgetWrapper.css'))
      .toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })

  it('reveals card actions on hover AND on focus-within, and always on touch', () => {
    const src = stripComments(read('src/components/dashboard/GadgetWrapper.css'))
    expect(ruleFor(rules, '.gadget-actions').body).toMatch(/opacity:\s*0/)
    // Keyboard users must get them back; and they must not be display:none,
    // which would take them out of the tab order entirely.
    expect(ruleFor(rules, '.gadget-actions').body).not.toMatch(/display:\s*none/)
    expect(src).toMatch(/\.gadget:focus-within \.gadget-actions/)
    expect(src).toMatch(/@media \(hover: none\)/)
  })
})

/* ────────────────────────────────────────────────────────────────
   Widget header icons
   ──────────────────────────────────────────────────────────────── */

describe('JL-472 — widget header icon consistency', () => {
  const GADGET = { id: 'g1', type: 'donut', title: 'Status Overview', size: 'small' }
  const noop = () => {}

  const renderWrapper = (gadget = GADGET) =>
    render(
      <GadgetWrapper
        gadget={gadget}
        onRemove={noop}
        onConfig={noop}
        onResize={noop}
        onMaximize={noop}
      >
        <div>body</div>
      </GadgetWrapper>,
    )

  it('gives each gadget a type glyph in its header', () => {
    const { container } = renderWrapper()
    expect(container.querySelector('.gadget-type-icon svg')).toBeTruthy()
  })

  it('draws a different glyph per gadget type', () => {
    const shapes = new Set()
    for (const type of ['pie', 'donut', 'bar', 'filterResults', 'activityStream', 'sprintHealth']) {
      const { container, unmount } = renderWrapper({ ...GADGET, type })
      shapes.add(container.querySelector('.gadget-type-icon svg').innerHTML)
      unmount()
    }
    expect(shapes.size).toBe(6)
  })

  it('falls back to a placeholder rather than dropping the icon and shifting the title', () => {
    const { container } = renderWrapper({ ...GADGET, type: 'somethingNew' })
    expect(container.querySelector('.gadget-type-icon svg')).toBeTruthy()
  })

  it('draws every header icon at one optical weight', () => {
    const { container } = renderWrapper()
    const strokes = [...container.querySelectorAll('.gadget-header svg[stroke]')]
      .map((svg) => svg.getAttribute('stroke-width'))
    expect(strokes.length).toBeGreaterThan(0)
    // Was a mix of 1.6 and 1.4 within a few pixels of each other.
    expect(new Set(strokes)).toEqual(new Set(['1.4']))
  })

  it('hides the decorative glyphs from screen readers', () => {
    const { container } = renderWrapper()
    expect(container.querySelector('.gadget-type-icon').getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.gadget-drag-handle').getAttribute('aria-hidden')).toBe('true')
  })

  it('names every icon-only action button after the gadget it acts on', () => {
    const { container } = renderWrapper()
    const buttons = [...container.querySelectorAll('.gadget-action-btn')]
    expect(buttons).toHaveLength(4)
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Resize Status Overview',
      'Configure Status Overview',
      'Maximize Status Overview',
      'Remove Status Overview',
    ])
  })
})

/* ────────────────────────────────────────────────────────────────
   Activity Stream empty state
   ──────────────────────────────────────────────────────────────── */

describe('JL-472 — Activity Stream uses the shared empty state', () => {
  it('renders <EmptyState>, not a bespoke <p> + <small>', () => {
    const { container } = render(<ActivityStreamGadget activity={[]} config={{}} />)
    expect(container.querySelector('.empty-state')).toBeTruthy()
    expect(container.querySelector('.activity-stream-empty')).toBeNull()
    expect(container.querySelector('small')).toBeNull()
  })

  it('keeps the wording and gains a heading and an icon', () => {
    const { container } = render(<ActivityStreamGadget activity={[]} config={{}} />)
    expect(screen.getByText('No activity yet').classList.contains('empty-state__title')).toBe(true)
    expect(screen.getByText(/Create some issues or invite teammates/)).toBeTruthy()
    expect(container.querySelector('.empty-state__icon svg')).toBeTruthy()
  })

  it('announces itself, because the list it replaces may have just emptied', () => {
    const { container } = render(<ActivityStreamGadget activity={[]} config={{}} />)
    expect(container.querySelector('.empty-state').getAttribute('role')).toBe('status')
  })

  it('no longer nests a scroll container inside the card body', () => {
    const rules = cssRules('src/pages/DashboardPage/DashboardPage.css')
    const gadget = ruleFor(rules, '.activity-stream-gadget')
    expect(gadget.body).not.toMatch(/max-height/)
    expect(gadget.body).not.toMatch(/overflow/)
    // The card body is the one that scrolls.
    const body = ruleFor(cssRules('src/components/dashboard/GadgetWrapper.css'), '.gadget-body')
    expect(body.body).toMatch(/overflow:\s*auto/)
  })
})

/* ────────────────────────────────────────────────────────────────
   Spacing rhythm
   ──────────────────────────────────────────────────────────────── */

describe('JL-472 — the page runs on one spacing scale', () => {
  const rules = cssRules('src/pages/DashboardPage/DashboardPage.css')

  it('uses the same gutter between the header, the filters and the grid', () => {
    expect(ruleFor(rules, '.dashboard-header').body).toMatch(/margin-bottom:\s*var\(--space-4\)/)
    expect(ruleFor(rules, '.dashboard-filters').body).toMatch(/margin-bottom:\s*var\(--space-4\)/)
    expect(ruleFor(rules, '.dashboard-grid').body).toMatch(/gap:\s*var\(--space-4\)/)
  })

  it('leaves no off-scale literal gap on the page-level containers', () => {
    for (const selector of ['.dashboard-header', '.dashboard-filters', '.dashboard-grid', '.pie-gadget', '.filter-results-gadget']) {
      const rule = ruleFor(rules, selector)
      expect(rule, `missing rule ${selector}`).toBeTruthy()
      expect(rule.body, `${selector} has a literal gap`).not.toMatch(/gap:\s*\d+px/)
    }
  })
})

/* ────────────────────────────────────────────────────────────────
   Responsive
   ──────────────────────────────────────────────────────────────── */

describe('JL-472 — the grid sheds columns instead of side-scrolling on a phone', () => {
  // One stable MediaQueryList, because useMediaQuery caches it per query —
  // flipping `matches` on this object is what a resize looks like to the hook.
  let mql

  beforeAll(() => {
    const listeners = new Set()
    mql = {
      matches: false,
      media: '(max-width: 640px)',
      addEventListener: (_type, cb) => listeners.add(cb),
      removeEventListener: (_type, cb) => listeners.delete(cb),
      fire(next) {
        mql.matches = next
        for (const cb of listeners) cb({ matches: next })
      },
    }
    window.matchMedia = vi.fn(() => mql)
  })

  it('shows all six columns on a wide viewport', () => {
    mql.matches = false
    const { container } = renderGrid()
    expect(container.querySelectorAll('thead th')).toHaveLength(6)
    expect(container.querySelectorAll('colgroup col')).toHaveLength(6)
  })

  it('drops Assignee and Created below 640px', () => {
    mql.matches = true
    const { container } = renderGrid()
    const labels = [...container.querySelectorAll('thead .th-sort-label')].map((n) => n.textContent)
    expect(labels).toEqual(['Key', 'Summary', 'Priority', 'Status'])
    mql.matches = false
  })

  it('keeps the <colgroup> and the cells in step at BOTH widths — the JL-469 invariant', () => {
    mql.matches = true
    const { container } = renderGrid()
    const cols = container.querySelectorAll('colgroup col').length
    expect(container.querySelectorAll('thead th')).toHaveLength(cols)
    for (const row of container.querySelectorAll('tbody tr')) {
      expect(row.querySelectorAll('td')).toHaveLength(cols)
    }
    mql.matches = false
  })

  it('re-proportions the surviving columns to a full 100%', () => {
    mql.matches = true
    const { container } = renderGrid()
    const total = [...container.querySelectorAll('colgroup col')]
      .reduce((sum, col) => sum + parseFloat(col.style.width), 0)
    expect(total).toBe(100)
    mql.matches = false
  })

  it('reacts to a resize without a remount', () => {
    mql.matches = false
    const { container } = renderGrid()
    expect(container.querySelectorAll('thead th')).toHaveLength(6)

    act(() => mql.fire(true))
    expect(container.querySelectorAll('thead th')).toHaveLength(4)

    act(() => mql.fire(false))
    expect(container.querySelectorAll('thead th')).toHaveLength(6)
  })

  it('keeps the empty-state cell spanning whatever columns remain', () => {
    mql.matches = true
    const { container } = renderGrid([])
    expect(container.querySelector('tbody td').getAttribute('colspan')).toBe('4')
    mql.matches = false
  })

  it('keeps a sort chosen on a wide viewport working after the column is dropped', () => {
    mql.matches = false
    const { container } = renderGrid()
    const createdHeader = container.querySelectorAll('thead th')[5]
    act(() => createdHeader.click())
    const wide = [...container.querySelectorAll('tbody tr td:first-child')].map((c) => c.textContent)

    act(() => mql.fire(true))
    const narrow = [...container.querySelectorAll('tbody tr td:first-child')].map((c) => c.textContent)
    // Created is gone from the header, but the rows keep the order it set.
    expect(narrow).toEqual(wide)
    act(() => mql.fire(false))
  })

  it('drops the min-width at the same breakpoint, so there is nothing left to scroll', () => {
    const src = stripComments(read('src/pages/DashboardPage/DashboardPage.css'))
    expect(src).toMatch(/@media \(max-width: 640px\)\s*\{\s*\.filter-results-table\s*\{\s*min-width:\s*0/)
  })
})

describe('JL-472 — the Priority cell survives both widths', () => {
  it('still renders the lozenge and the em dash when narrowed', () => {
    const { container } = renderGrid()
    const rows = container.querySelectorAll('tbody tr')
    expect(within(rows[0].querySelectorAll('td')[3]).getByText('High')).toBeTruthy()
    expect(rows[1].querySelectorAll('td')[3].textContent).toBe('—')
  })
})
