// JL-402 — Audit Log: trimmed columns, real pagination, date-only filters.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockFetchAuditLog, mockVerify, mockDownload } = vi.hoisted(() => ({
  mockFetchAuditLog: vi.fn(),
  mockVerify: vi.fn(),
  mockDownload: vi.fn(),
}))

vi.mock('../api/auditLogApi', () => ({
  fetchAuditLog: mockFetchAuditLog,
  verifyAuditLog: mockVerify,
  downloadAuditExport: mockDownload,
}))

let mockPerms = { isAdmin: true }
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => mockPerms }))

import { AuditLogPage } from '../pages/AuditLogPage/AuditLogPage'

const TOTAL = 120
const entry = (seq) => ({
  id: seq,
  seq,
  actor: `user${seq}@test.com`,
  action: 'login',
  target: `target-${seq}`,
  metadata: { ip: '10.0.0.1' },
  hash: `hash${seq}abcdef0123456789`,
  created_at: '2026-08-14T10:00:00Z',
})

/** The query object the page passed to the API on its most recent call. */
const lastQuery = () => mockFetchAuditLog.mock.calls.at(-1)?.[0] ?? {}

beforeEach(() => {
  vi.clearAllMocks()
  mockPerms = { isAdmin: true }
  mockFetchAuditLog.mockImplementation(({ offset = 0, limit = 25 } = {}) =>
    Promise.resolve({
      entries: Array.from({ length: Math.min(limit, TOTAL - offset) }, (_, i) => entry(offset + i + 1)),
      total: TOTAL,
      limit,
      offset,
    }),
  )
})

describe('JL-402 — the table shows only the readable columns', () => {
  it('renders #, Actor, Action and Time', async () => {
    render(<AuditLogPage />)
    await waitFor(() => expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0))
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent.trim()))
      .toEqual(['#', 'Actor', 'Action', 'Time'])
  })

  it('drops the Target, Metadata and Hash columns', async () => {
    render(<AuditLogPage />)
    await waitFor(() => expect(screen.getAllByRole('columnheader').length).toBe(4))
    for (const gone of ['Target', 'Metadata', 'Hash']) {
      expect(
        screen.queryByRole('columnheader', { name: new RegExp(`^${gone}$`, 'i') }),
        gone,
      ).toBeNull()
    }
  })

  it('renders no metadata blob or hash digest in the rows', async () => {
    render(<AuditLogPage />)
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1))
    const body = document.querySelector('tbody')
    // The stringified metadata and the truncated hash were the two cells that
    // pushed this table into sideways scrolling.
    expect(body.textContent).not.toContain('10.0.0.1')
    expect(body.textContent).not.toContain('hash1abcdef')
    expect(body.textContent).not.toContain('target-1')
    // …but the row is still identifiable.
    expect(body.textContent).toContain('user1@test.com')
  })

  it('keeps the export and verify controls, which are what expose the hash chain', async () => {
    render(<AuditLogPage />)
    await waitFor(() => expect(mockFetchAuditLog).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /Verify integrity/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^CSV$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^JSON$/ })).toBeInTheDocument()
  })
})

describe('JL-402 — pagination', () => {
  it('asks the server for a page rather than everything', async () => {
    render(<AuditLogPage />)
    await waitFor(() => expect(mockFetchAuditLog).toHaveBeenCalled())
    expect(lastQuery()).toMatchObject({ limit: 25, offset: 0 })
  })

  it('counts from the server total, not the rows it happens to hold', async () => {
    render(<AuditLogPage />)
    // 120 total behind a 25-row page: the old caption said "Showing 25 of 120"
    // and offered no way to reach the rest.
    expect(await screen.findByText(/1–25 of 120/)).toBeInTheDocument()
  })

  it('fetches the next slice when the page changes', async () => {
    render(<AuditLogPage />)
    await waitFor(() => expect(mockFetchAuditLog).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))

    await waitFor(() => expect(lastQuery()).toMatchObject({ limit: 25, offset: 25 }))
    expect(await screen.findByText(/26–50 of 120/)).toBeInTheDocument()
    // The rows really are the next slice, not a re-render of the first.
    const firstCell = document.querySelector('tbody tr td')
    expect(firstCell.textContent).toBe('26')
  })

  it('changes page size and returns to the first page', async () => {
    render(<AuditLogPage />)
    await waitFor(() => expect(mockFetchAuditLog).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    await waitFor(() => expect(lastQuery().offset).toBe(25))

    fireEvent.change(screen.getByLabelText(/Rows per page/i), { target: { value: '50' } })
    await waitFor(() => expect(lastQuery()).toMatchObject({ limit: 50, offset: 0 }))
  })

  it('resets to the first page when a filter changes', async () => {
    // Otherwise a narrowed filter can strand the user on a page that no longer
    // exists — an empty table above a non-zero total.
    render(<AuditLogPage />)
    await waitFor(() => expect(mockFetchAuditLog).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    await waitFor(() => expect(lastQuery().offset).toBe(25))

    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: 'someone@test.com' } })
    await waitFor(() => expect(lastQuery()).toMatchObject({ actor: 'someone@test.com', offset: 0 }))
  })
})

describe('JL-402 — date-only filters', () => {
  it('uses date pickers with no time component', async () => {
    render(<AuditLogPage />)
    await waitFor(() => expect(mockFetchAuditLog).toHaveBeenCalled())
    for (const label of ['From', 'To']) {
      const input = screen.getByLabelText(label)
      expect(input.type, `${label} should be a date input`).toBe('date')
    }
    expect(document.querySelectorAll('input[type="datetime-local"]')).toHaveLength(0)
  })

  it('sends the bounds through to the query', async () => {
    render(<AuditLogPage />)
    await waitFor(() => expect(mockFetchAuditLog).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-14' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-14' } })
    // The server widens a date-only `To` to the end of that day — see
    // audit-date-filter-JL402.test.js, which is where that behaviour lives.
    await waitFor(() => expect(lastQuery()).toMatchObject({
      dateFrom: '2026-08-14', dateTo: '2026-08-14',
    }))
  })
})

describe('JL-402 — unchanged behaviour', () => {
  it('still gates the page to admins', async () => {
    mockPerms = { isAdmin: false }
    render(<AuditLogPage />)
    expect(await screen.findByText(/Admins only/i)).toBeInTheDocument()
    expect(mockFetchAuditLog).not.toHaveBeenCalled()
  })

  it('shows the empty state when there is nothing to show', async () => {
    mockFetchAuditLog.mockResolvedValue({ entries: [], total: 0, limit: 25, offset: 0 })
    render(<AuditLogPage />)
    expect(await screen.findByText(/No audit entries/i)).toBeInTheDocument()
  })
})
