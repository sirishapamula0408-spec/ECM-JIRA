/* ================================================================
   JL-469 — Filter Results grid: header/cell alignment and the empty
   SUMMARY column.

   Two independent defects behind one symptom.

   1. ALIGNMENT. `src/styles/shared.css` declared

        .table th,
        .table td { padding; text-align: left; border-bottom }

      and the JL-447 tabular-numerals block was later inserted BETWEEN
      those two lines. That is not a comment inside a rule — it is a
      comment in the middle of a SELECTOR LIST, so `.table th` was
      absorbed into the `.tabular-nums` rule and received nothing but
      `font-variant-numeric`. Every table header in the app silently
      lost its padding, its left alignment and its bottom border, and
      fell back to the UA default `text-align: center` while the cells
      below stayed left-aligned. No column label sat over its data.

      jsdom loads no stylesheets, so the guard here reads the CSS
      source: the rule that left-aligns `.table td` must also name
      `.table th`. That is the exact property the insertion broke, and
      it is the one a future insertion would break again.

   2. EMPTY SUMMARY. The gadget read `issue.summary`, but the API's
      issue shape (mapIssue in server/routes/issues.js) names that
      field `title`. Against real data every SUMMARY cell was blank.
      The existing fixtures spell it `summary`, which is precisely why
      no test caught it — so these fixtures deliberately use `title`.
   ================================================================ */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FilterResultsGadget } from '../components/dashboard/gadgets/FilterResultsGadget'

// The API shape: `title`, no `summary` anywhere. This is what the dashboard
// actually hands the gadget.
const API_SHAPE_ISSUES = [
  { id: 1, key: 'ECM-1', title: 'Fix the donut colours', assignee: 'a@x.com', priority: 'High', status: 'To Do', createdAt: '2026-04-05T10:00:00.000Z' },
  { id: 2, key: 'ECM-2', title: 'Align the grid headers', assignee: 'b@x.com', priority: 'Low', status: 'Done', createdAt: '2025-12-20T10:00:00.000Z' },
]

// The older/filter-model shape, still supported.
const LEGACY_SHAPE_ISSUES = [
  { id: 3, key: 'ECM-3', summary: 'Legacy summary field', assignee: 'c@x.com', priority: 'Medium', status: 'Backlog', createdAt: '2026-01-02T10:00:00.000Z' },
]

const renderGadget = (issues, config = {}) =>
  render(
    <MemoryRouter>
      <FilterResultsGadget issues={issues} config={config} />
    </MemoryRouter>,
  )

/* Strip CSS comments, then split into `selector { body }` rules. Good enough
   for a hand-written stylesheet and, unlike a regex over the raw text, it
   cannot be fooled by the rule living inside a comment. */
function cssRules(path) {
  const src = readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, ' '),
    body: m[2],
  }))
}

describe('JL-469 — the shared table rule still applies to <th>', () => {
  const rules = cssRules('src/styles/shared.css')

  it('left-aligns .table th in the same rule that left-aligns .table td', () => {
    const aligning = rules.filter((r) => /text-align:\s*left/.test(r.body))
    const shared = aligning.find(
      (r) => r.selector.includes('.table th') && r.selector.includes('.table td'),
    )
    expect(shared, 'no rule left-aligns .table th and .table td together').toBeTruthy()
  })

  it('gives .table th back the padding and border it shares with .table td', () => {
    const rule = rules.find(
      (r) => r.selector.includes('.table th') && r.selector.includes('.table td') && /padding:/.test(r.body),
    )
    expect(rule).toBeTruthy()
    // JL-472 raised the row from 8/10 to 10/12 (~36px -> ~40px). What this
    // guard is about is that th and td take the padding TOGETHER, whatever the
    // value is, so assert the shape rather than the number.
    expect(rule.body).toMatch(/padding:\s*\d+px \d+px/)
    expect(rule.body).toMatch(/border-bottom:/)
  })

  it('keeps .tabular-nums out of the .table selector list entirely', () => {
    // The regression was `.table th, <comment> .tabular-nums { ... }`. Any rule
    // that names .tabular-nums must name nothing else.
    for (const rule of rules.filter((r) => r.selector.includes('.tabular-nums'))) {
      expect(rule.selector).toBe('.tabular-nums')
    }
  })
})

describe('JL-469 — column widths are declared once, for the whole column', () => {
  it('renders a <colgroup> with one <col> per header cell', () => {
    const { container } = renderGadget(API_SHAPE_ISSUES)
    const cols = container.querySelectorAll('colgroup col')
    const headers = container.querySelectorAll('thead th')
    expect(cols.length).toBe(headers.length)
    expect(cols.length).toBe(6)
  })

  it('gives every column an explicit width, so header and body cannot size independently', () => {
    const { container } = renderGadget(API_SHAPE_ISSUES)
    for (const col of container.querySelectorAll('colgroup col')) {
      expect(col.style.width).toMatch(/^\d+%$/)
    }
  })

  it('declares widths that total 100%', () => {
    const { container } = renderGadget(API_SHAPE_ISSUES)
    const total = [...container.querySelectorAll('colgroup col')]
      .reduce((sum, col) => sum + parseFloat(col.style.width), 0)
    expect(total).toBe(100)
  })

  it('every body row has exactly as many cells as there are columns', () => {
    const { container } = renderGadget(API_SHAPE_ISSUES)
    const columnCount = container.querySelectorAll('thead th').length
    for (const row of container.querySelectorAll('tbody tr')) {
      expect(row.querySelectorAll('td')).toHaveLength(columnCount)
    }
  })
})

describe('JL-469 — no cell sets its own alignment', () => {
  it('sets no inline textAlign on any header or body cell', () => {
    const { container } = renderGadget(API_SHAPE_ISSUES)
    for (const cell of container.querySelectorAll('th, td')) {
      expect(cell.style.textAlign).toBe('')
    }
  })

  it('leaves the empty-state row to the same rule as every other cell', () => {
    const { container } = renderGadget([])
    const cell = container.querySelector('tbody td')
    expect(cell.textContent).toBe('No issues found')
    // It used to carry style={{ textAlign: 'center', color: '#6b778c' }} — a
    // third, hardcoded opinion about alignment, and a raw hex besides.
    expect(cell.style.textAlign).toBe('')
    expect(cell.style.color).toBe('')
    expect(cell.classList.contains('filter-results-empty')).toBe(true)
  })

  it('spans the empty-state cell across every column', () => {
    const { container } = renderGadget([])
    const cell = container.querySelector('tbody td')
    expect(cell.getAttribute('colspan')).toBe('6')
  })
})

describe('JL-469 — the sort arrow is inline with its header label', () => {
  it('wraps label and arrow together in one element', () => {
    const { container } = renderGadget(API_SHAPE_ISSUES)
    for (const th of container.querySelectorAll('thead th')) {
      const unit = th.querySelector('.th-sort')
      expect(unit, 'header cell has no .th-sort wrapper').toBeTruthy()
      expect(unit.querySelector('.th-sort-label')).toBeTruthy()
      expect(unit.querySelector('.sort-icon')).toBeTruthy()
      // Nothing between them but the wrapper's own children.
      expect(unit.children).toHaveLength(2)
    }
  })

  it('exposes the sorted column to assistive tech', () => {
    const { container } = renderGadget(API_SHAPE_ISSUES)
    const headers = [...container.querySelectorAll('thead th')]
    // Default sort is key asc.
    expect(headers[0].getAttribute('aria-sort')).toBe('ascending')
    expect(headers.slice(1).map((h) => h.getAttribute('aria-sort'))).toEqual(
      ['none', 'none', 'none', 'none', 'none'],
    )

    fireEvent.click(headers[0])
    expect(headers[0].getAttribute('aria-sort')).toBe('descending')
  })
})

describe('JL-469 — the SUMMARY column renders the issue title', () => {
  it('reads `title`, the field the API actually sends', () => {
    renderGadget(API_SHAPE_ISSUES)
    expect(screen.getByText('Fix the donut colours')).toBeTruthy()
    expect(screen.getByText('Align the grid headers')).toBeTruthy()
  })

  it('still reads `summary` where that is the field present', () => {
    renderGadget(LEGACY_SHAPE_ISSUES)
    expect(screen.getByText('Legacy summary field')).toBeTruthy()
  })

  it('falls back to the em dash when an issue genuinely has neither', () => {
    const { container } = renderGadget([
      { id: 9, key: 'ECM-9', assignee: 'z@x.com', priority: 'Low', status: 'To Do', createdAt: null },
    ])
    const summaryCell = container.querySelector('tbody td.filter-results-summary')
    expect(summaryCell.textContent).toBe('—')
    // ...and no misleading tooltip on an empty cell.
    expect(summaryCell.getAttribute('title')).toBeNull()
  })

  it('carries the full text as a title attribute, because the column now clips', () => {
    const { container } = renderGadget(API_SHAPE_ISSUES)
    const cells = container.querySelectorAll('tbody td.filter-results-summary')
    expect(cells[0].getAttribute('title')).toBe(cells[0].textContent)
  })

  it('sorts by Summary using the same accessor it renders with', () => {
    // Before the fix this compared undefined with undefined on every row: the
    // click registered, the order never changed.
    const { container } = renderGadget(API_SHAPE_ISSUES)
    const summaryHeader = container.querySelectorAll('thead th')[1]

    fireEvent.click(summaryHeader)
    const asc = [...container.querySelectorAll('tbody td.filter-results-summary')].map((c) => c.textContent)
    expect(asc).toEqual(['Align the grid headers', 'Fix the donut colours'])

    fireEvent.click(summaryHeader)
    const desc = [...container.querySelectorAll('tbody td.filter-results-summary')].map((c) => c.textContent)
    expect(desc).toEqual(['Fix the donut colours', 'Align the grid headers'])
  })
})

describe('JL-469 — the header labels are the Atlassian column set', () => {
  it('names the six columns in order', () => {
    const { container } = renderGadget(API_SHAPE_ISSUES)
    const labels = [...container.querySelectorAll('thead .th-sort-label')].map((n) => n.textContent)
    expect(labels).toEqual(['Key', 'Summary', 'Assignee', 'Priority', 'Status', 'Created'])
  })

  it('keeps the lozenge columns rendering lozenges, not bare text', () => {
    const { container } = renderGadget(API_SHAPE_ISSUES)
    const firstRow = container.querySelector('tbody tr')
    const cells = firstRow.querySelectorAll('td')
    // Priority is a pill; JL-472 added the --lozenge modifier so it matches the
    // status lozenge beside it. Status is the shared <StatusLozenge> since
    // JL-472 — it used to be a flat grey `.pill` that said nothing.
    expect(within(cells[3]).getByText('High').classList.contains('pill')).toBe(true)
    expect(cells[4].querySelector('.status-lozenge')).toBeTruthy()
    expect(cells[4].textContent).toContain('To Do')
  })
})
