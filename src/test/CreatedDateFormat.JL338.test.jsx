import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { FilterResultsGadget } from '../components/dashboard/gadgets/FilterResultsGadget'
import { formatDateOnly } from '../utils/timeAgo'

// JL-338 — the Created column must render a human-readable date only
// (via the shared formatDateOnly util), never the raw ISO timestamp,
// while sorting keeps ordering by the underlying timestamp.

const ISSUES = [
  // Chosen so that sorting by the FORMATTED string would give a different
  // order than sorting by the timestamp: alphabetically "Apr 5, 2026" comes
  // before "Dec 20, 2025", but chronologically Dec 2025 is earlier.
  { id: 1, key: 'ECM-1', summary: 'Newer issue', assignee: 'a@x.com', priority: 'High', status: 'To Do', createdAt: '2026-04-05T10:00:00.000Z' },
  { id: 2, key: 'ECM-2', summary: 'Older issue', assignee: 'b@x.com', priority: 'Low', status: 'Done', createdAt: '2025-12-20T10:00:00.000Z' },
]

function renderGadget(issues) {
  // JL-337 made the Key cell a react-router <Link>, which needs a router in
  // scope — assertions below are unchanged.
  return render(
    <MemoryRouter>
      <FilterResultsGadget issues={issues} config={{}} />
    </MemoryRouter>,
  )
}

function createdCells(container) {
  // Created is the 6th (last) column.
  return Array.from(container.querySelectorAll('tbody tr')).map(
    (tr) => tr.querySelectorAll('td')[5]?.textContent,
  )
}

describe('JL-338 — formatDateOnly util', () => {
  it('formats an ISO timestamp as a date only, using the UTC calendar day', () => {
    expect(formatDateOnly('2026-07-07T03:25:29.927Z')).toBe('Jul 7, 2026')
    // 22:30 UTC is already the next day in timezones east of UTC — the
    // displayed date must stay on the UTC day regardless of local tz.
    expect(formatDateOnly('2026-07-06T22:30:00.000Z')).toBe('Jul 6, 2026')
  })

  it('returns an empty string for missing or unparseable input without throwing', () => {
    expect(formatDateOnly(null)).toBe('')
    expect(formatDateOnly(undefined)).toBe('')
    expect(formatDateOnly('')).toBe('')
    expect(formatDateOnly('not-a-date')).toBe('')
  })
})

describe('JL-338 — Filter Results Created column', () => {
  it('renders a formatted date, not the raw ISO timestamp', () => {
    renderGadget(ISSUES)
    expect(screen.getByText('Apr 5, 2026')).toBeInTheDocument()
    expect(screen.getByText('Dec 20, 2025')).toBeInTheDocument()
    expect(screen.queryByText('2026-04-05T10:00:00.000Z')).not.toBeInTheDocument()
  })

  it('falls back to — for a missing createdAt and does not throw on an invalid one', () => {
    const { container } = renderGadget([
      { id: 3, key: 'ECM-3', summary: 'No date', priority: 'Low', status: 'To Do', createdAt: null },
      { id: 4, key: 'ECM-4', summary: 'Bad date', priority: 'Low', status: 'To Do', createdAt: 'not-a-date' },
    ])
    expect(createdCells(container)).toEqual(['—', '—'])
  })

  it('sorting the Created column orders by timestamp, not by the formatted string', () => {
    const { container } = renderGadget(ISSUES)

    // Click the Created header → ascending. Chronological asc puts Dec 2025
    // first; a formatted-string sort would wrongly put "Apr 5, 2026" first.
    fireEvent.click(screen.getByText(/^Created/))
    expect(createdCells(container)).toEqual(['Dec 20, 2025', 'Apr 5, 2026'])

    // Second click → descending, still chronological.
    fireEvent.click(screen.getByText(/^Created/))
    expect(createdCells(container)).toEqual(['Apr 5, 2026', 'Dec 20, 2025'])
  })
})
