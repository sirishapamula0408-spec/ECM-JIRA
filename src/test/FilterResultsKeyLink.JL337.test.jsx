import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FilterResultsGadget } from '../components/dashboard/gadgets/FilterResultsGadget'

// JL-337 — the issue Key in the Filter Results gadget is styled like a link,
// so it must BE a real link: an anchor pointing at the issue detail route
// (/issues/:issueId, keyed by numeric id — not the display key). A real
// anchor gives middle-click / open-in-new-tab / hover URL preview and
// keyboard focus + Enter activation for free.

const ISSUES = [
  { id: 42, key: 'ECM-7', summary: 'Linkable issue', assignee: 'a@x.com', priority: 'High', status: 'To Do', createdAt: '2026-04-05T10:00:00.000Z' },
  { id: 99, key: 'ECM-12', summary: 'Another issue', assignee: 'b@x.com', priority: 'Low', status: 'Done', createdAt: '2025-12-20T10:00:00.000Z' },
]

function renderGadget(issues = ISSUES) {
  // <Link> requires a router in scope, same as other gadget tests.
  return render(
    <MemoryRouter>
      <FilterResultsGadget issues={issues} config={{}} />
    </MemoryRouter>,
  )
}

describe('JL-337 — Filter Results issue key is a real link', () => {
  it('renders the key cell as an anchor, not a plain span', () => {
    const { container } = renderGadget()
    const firstKeyCell = container.querySelector('tbody tr td')
    const anchor = firstKeyCell.querySelector('a')
    expect(anchor).not.toBeNull()
    // No leftover non-interactive span pretending to be the key.
    expect(firstKeyCell.querySelector('span.filter-results-key')).toBeNull()
  })

  it('links to /issues/:id using the issue id, with the display key as visible text', () => {
    const { container } = renderGadget()
    const anchors = Array.from(container.querySelectorAll('tbody a.filter-results-key'))
    expect(anchors).toHaveLength(2)
    // Default sort is by key asc: 'ECM-12' < 'ECM-7' alphabetically.
    expect(anchors[0].getAttribute('href')).toBe('/issues/99')
    expect(anchors[0].textContent).toBe('ECM-12')
    expect(anchors[1].getAttribute('href')).toBe('/issues/42')
    expect(anchors[1].textContent).toBe('ECM-7')
  })

  it('keeps the existing visual class so the styling is unchanged', () => {
    const { container } = renderGadget()
    const anchor = container.querySelector('tbody a')
    expect(anchor.classList.contains('filter-results-key')).toBe(true)
  })

  it('is keyboard focusable', () => {
    const { container } = renderGadget()
    const anchor = container.querySelector('tbody a')
    // An anchor with an href is in the tab order by default; nothing must
    // opt it out (no tabIndex="-1").
    expect(anchor.getAttribute('tabindex')).not.toBe('-1')
    anchor.focus()
    expect(document.activeElement).toBe(anchor)
  })
})
