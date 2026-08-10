import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

/**
 * JL-380 — Activity page pagination + loading / empty / error states.
 *
 * Mocking follows src/test/collaboration-pages.test.jsx: the page only talks to
 * dashboardApi (activity), projectApi and memberApi (filter option lists).
 */
vi.mock('../api/dashboardApi', () => ({
  fetchActivity: vi.fn(),
}))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn().mockResolvedValue([]),
}))

import { ActivityFeedPage } from '../pages/ActivityFeedPage/ActivityFeedPage'
import { fetchActivity } from '../api/dashboardApi'

function makeActivities(count, startId = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    actor: `User ${startId + i}`,
    action: `updated IT-${startId + i}`,
    activity_type: 'issue',
    created_at: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
  }))
}

function renderPage() {
  return render(<BrowserRouter><ActivityFeedPage /></BrowserRouter>)
}

/** The native rows-per-page <select> rendered by MUI TablePagination. */
function rowsPerPageSelect() {
  return screen.getByLabelText('Activities per page')
}

/**
 * The "type" filter is an MUI Select (JL-379), not a native <select> — its
 * options only enter the DOM once the combobox is opened, so drive it the way
 * the JL-379 suite does rather than firing a change event at the input.
 */
async function selectMuiOption(comboboxName, optionName) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: comboboxName }))
  fireEvent.click(await screen.findByRole('option', { name: optionName }))
}

describe('ActivityFeedPage pagination (JL-380)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchActivity.mockResolvedValue({ activities: makeActivities(25), total: 120 })
  })

  it('renders pagination controls showing the total count', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/of 120/)).toBeInTheDocument())
    expect(screen.getByLabelText('Activities per page')).toBeInTheDocument()
    // First load requests page 1 with the default page size.
    expect(fetchActivity).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, offset: 0 }),
    )
  })

  it('refetches with the correct offset when the page changes', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/of 120/)).toBeInTheDocument())

    fetchActivity.mockResolvedValue({ activities: makeActivities(25, 26), total: 120 })
    fireEvent.click(screen.getByLabelText('Go to next page'))

    await waitFor(() => {
      expect(fetchActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 25, offset: 25 }),
      )
    })
  })

  it('refetches with the new limit and resets to page 0 when rows-per-page changes', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/of 120/)).toBeInTheDocument())

    // Move to page 2 first so the reset is observable.
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => {
      expect(fetchActivity).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 }))
    })

    fireEvent.change(rowsPerPageSelect(), { target: { value: '50' } })

    await waitFor(() => {
      expect(fetchActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 50, offset: 0 }),
      )
    })
  })

  it('resets pagination to the first page when a filter changes', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/of 120/)).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => {
      expect(fetchActivity).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 }))
    })

    await selectMuiOption(/^Type/, 'Comments')

    await waitFor(() => {
      expect(fetchActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'comment', offset: 0 }),
      )
    })
  })

  it('shows a progress indicator while loading', async () => {
    let resolveLoad
    fetchActivity.mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve }))
    renderPage()

    expect(screen.getByRole('progressbar')).toBeInTheDocument()

    resolveLoad({ activities: [], total: 0 })
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
  })

  it('renders the shared empty state when there is no activity', async () => {
    fetchActivity.mockResolvedValue({ activities: [], total: 0 })
    renderPage()

    await waitFor(() => expect(screen.getByText('No activity found')).toBeInTheDocument())
    expect(screen.getByText(/Issue updates, comments and sprint changes/)).toBeInTheDocument()
  })

  it('renders an error alert — and NOT the empty state — when the load fails', async () => {
    fetchActivity.mockRejectedValue(new Error('Activity service unavailable'))
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Activity service unavailable')).toBeInTheDocument()
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    // Regression guard: a swallowed error used to look like an empty feed.
    expect(screen.queryByText('No activity found')).not.toBeInTheDocument()
  })

  it('renders timestamps through the shared RelativeTime component', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByText('updated IT-1')).toBeInTheDocument())

    const times = container.querySelectorAll('time')
    expect(times.length).toBeGreaterThan(0)
    expect(times[0].getAttribute('datetime')).toBeTruthy()
  })
})
