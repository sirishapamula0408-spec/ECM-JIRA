import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

/**
 * JL-382 — Activity page: filters on a single row, activities as a table.
 *
 * Direct user feedback on the JL-378…JL-381 migration: the six filter controls
 * wrapped onto several rows, and the feed was still a bespoke card list rather
 * than a table like the User Management page.
 *
 * Mocking follows src/test/collaboration-pages.test.jsx — the page only talks
 * to dashboardApi (activity) plus projectApi/memberApi (filter option lists).
 */
vi.mock('../api/dashboardApi', () => ({
  fetchActivity: vi.fn(),
}))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([{ id: 7, name: 'Apollo' }]),
}))
vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn().mockResolvedValue([{ id: 3, name: 'Jane Doe', email: 'jane@test.com' }]),
}))

import { ActivityFeedPage } from '../pages/ActivityFeedPage/ActivityFeedPage'
import { fetchActivity } from '../api/dashboardApi'

const ACTIVITIES = [
  {
    id: 1,
    actor: 'Ada Lovelace',
    action: 'created IT-1',
    activity_type: 'issue',
    created_at: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: 2,
    actor: 'Grace Hopper',
    action: 'commented on IT-2',
    activity_type: 'comment',
    created_at: new Date(Date.now() - 120_000).toISOString(),
  },
  {
    id: 3,
    actor: 'Alan Turing',
    action: 'logged in',
    activity_type: 'general',
    created_at: new Date(Date.now() - 180_000).toISOString(),
  },
]

function renderPage() {
  return render(<BrowserRouter><ActivityFeedPage /></BrowserRouter>)
}

async function renderWithActivities(rows = ACTIVITIES) {
  fetchActivity.mockResolvedValue({ activities: rows, total: rows.length })
  const utils = renderPage()
  await waitFor(() => expect(screen.getByRole('table', { name: 'Activity' })).toBeInTheDocument())
  return utils
}

/** Body rows of the activity table (the head row is excluded). */
function bodyRows() {
  const table = screen.getByRole('table', { name: 'Activity' })
  return within(table.tBodies[0]).getAllByRole('row')
}

describe('ActivityFeedPage table (JL-382)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchActivity.mockResolvedValue({ activities: ACTIVITIES, total: ACTIVITIES.length })
  })

  it('renders the activity table with User / Action / Type / Time columns', async () => {
    await renderWithActivities()
    const table = screen.getByRole('table', { name: 'Activity' })
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers).toEqual(['User', 'Action', 'Type', 'Time'])
  })

  it('renders one row per activity with the actor name and action text', async () => {
    await renderWithActivities()
    const rows = bodyRows()
    expect(rows).toHaveLength(ACTIVITIES.length)

    ACTIVITIES.forEach((activity, i) => {
      const cells = within(rows[i]).getAllByRole('cell')
      expect(cells).toHaveLength(4)
      expect(cells[0]).toHaveTextContent(activity.actor)
      expect(cells[1]).toHaveTextContent(activity.action)
    })

    // The User cell carries an avatar with the actor's initials, matching the
    // UserManagementPage pattern.
    expect(within(rows[0]).getByText('AD')).toBeInTheDocument()
  })

  it('shows the Type chip for typed activities and omits it for "general"', async () => {
    await renderWithActivities()
    const rows = bodyRows()

    const issueTypeCell = within(rows[0]).getAllByRole('cell')[2]
    expect(issueTypeCell).toHaveTextContent('issue')
    expect(issueTypeCell.querySelector('.MuiChip-root')).not.toBeNull()

    const commentTypeCell = within(rows[1]).getAllByRole('cell')[2]
    expect(commentTypeCell).toHaveTextContent('comment')

    // 'general' is the catch-all bucket — no chip, and the cell stays empty.
    const generalTypeCell = within(rows[2]).getAllByRole('cell')[2]
    expect(generalTypeCell.querySelector('.MuiChip-root')).toBeNull()
    expect(generalTypeCell).toHaveTextContent('')
  })

  it('renders each row timestamp through the shared RelativeTime component', async () => {
    await renderWithActivities()
    const rows = bodyRows()

    rows.forEach((row, i) => {
      const time = within(row).getAllByRole('cell')[3].querySelector('time')
      expect(time).not.toBeNull()
      expect(time.getAttribute('datetime')).toBe(
        new Date(ACTIVITIES[i].created_at).toISOString(),
      )
    })
  })

  it('falls back to "Just now" when an activity has no timestamp', async () => {
    await renderWithActivities([
      { id: 9, actor: 'Nobody', action: 'did something', activity_type: 'issue' },
    ])
    expect(screen.getByText('Just now')).toBeInTheDocument()
  })

  it('keeps all six filter controls in one non-wrapping row', async () => {
    const { container } = await renderWithActivities()

    const toolbar = container.querySelector('.af-filter-bar')
    expect(toolbar).not.toBeNull()
    const row = toolbar.querySelector('.MuiStack-root')
    expect(row).not.toBeNull()

    // All six controls live in that single flex container, as direct children —
    // so "one row" is decided purely by this container's flex-wrap.
    expect(row.children).toHaveLength(6)
    expect(row).toContainElement(screen.getByRole('combobox', { name: /^Type/ }))
    expect(row).toContainElement(screen.getByRole('combobox', { name: /^Project/ }))
    expect(row).toContainElement(screen.getByRole('combobox', { name: /^Member/ }))
    expect(row).toContainElement(screen.getByLabelText('From'))
    expect(row).toContainElement(screen.getByLabelText('To'))
    expect(row).toContainElement(screen.getByRole('button', { name: 'Clear' }))

    // Emotion injects real stylesheets under jsdom, so this reads the cascaded
    // value rather than an inline style. The header Stack below is a positive
    // control proving the assertion can still observe "wrap".
    const style = getComputedStyle(row)
    expect(style.display).toBe('flex')
    expect(style.flexDirection).toBe('row')
    expect(style.flexWrap).toBe('nowrap')

    // Non-shrinking children: with nowrap alone the browser would squash the
    // controls to fit; instead the toolbar scrolls (.af-filter-bar).
    for (const child of row.children) {
      expect(getComputedStyle(child).flexShrink).toBe('0')
    }

    const headerStack = container.querySelector('.MuiStack-root')
    expect(headerStack).not.toBe(row)
    expect(getComputedStyle(headerStack).flexWrap).toBe('wrap')
  })
})
