import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

// Mock the API modules the page fetches on mount (same approach as collaboration-pages.test.jsx)
vi.mock('../api/dashboardApi', () => ({
  fetchActivity: vi.fn().mockResolvedValue({ activities: [], total: 0 }),
}))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([]),
  fetchProjectById: vi.fn().mockResolvedValue({ name: 'Test Project' }),
}))
vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn().mockResolvedValue([]),
  fetchProfile: vi.fn().mockResolvedValue(null),
}))

import { ActivityFeedPage } from '../pages/ActivityFeedPage/ActivityFeedPage'
import { fetchActivity } from '../api/dashboardApi'

function renderWithRouter(component) {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('ActivityFeedPage shell (JL-378)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the "Activity Feed" title as the page level-1 heading', () => {
    renderWithRouter(<ActivityFeedPage />)
    const heading = screen.getByRole('heading', { name: /activity feed/i })
    expect(heading).toBeInTheDocument()
    // JL-409: was an <h5>, because the title used Typography variant="h5".
    // That gave this page no h1 at all — a screen reader got an outline starting
    // mid-hierarchy — and a size (21px) no other page used. It is now a plain
    // <h1> picking up the shared `.page h1` treatment, so the assertion checks
    // the level rather than the MUI element it used to render.
    expect(heading.tagName).toBe('H1')
  })

  it('renders a descriptive subtitle beneath the heading', () => {
    renderWithRouter(<ActivityFeedPage />)
    expect(
      screen.getByText(/chronological record of issue, comment and sprint activity/i),
    ).toBeInTheDocument()
  })

  it('renders the activity count when the API returns a total', async () => {
    fetchActivity.mockResolvedValueOnce({ activities: [], total: 7 })
    renderWithRouter(<ActivityFeedPage />)
    await waitFor(() => {
      expect(screen.getByText(/7 activities/i)).toBeInTheDocument()
    })
  })
})
