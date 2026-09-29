import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'

/* ================================================================
   JL-152 — Confluence Lite home page.

   Covers, per the ticket:
     - both sections render with data
     - every empty state renders (no history, no team activity, nothing
       popular, and the first-run case with no spaces at all)
     - an empty grid is NEVER rendered in place of an empty state
     - the page shows only what the server returned — the permission
       filter is server-side, so the client must not widen it
     - sidebar collapse AND section expansion persist across a remount
     - switching tabs refetches and changes the feed
     - a card navigates to that page's route
   ================================================================ */

const { mockApi, mockAuth } = vi.hoisted(() => ({
  mockApi: {
    fetchWikiHome: vi.fn(),
    fetchWikiFeed: vi.fn(),
    fetchWikiList: vi.fn(),
    recordPageView: vi.fn(),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
  },
  mockAuth: { current: { authUser: { email: 'me@x.com' } } },
}))

vi.mock('../api/wikiHomeApi', () => mockApi)
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth.current }))

import { WikiHomePage } from '../pages/WikiHomePage/WikiHomePage'
import { WikiSidebar } from '../components/wiki/WikiSidebar'

const PAGE = {
  id: 11,
  title: 'Deploy runbook',
  space_id: 7,
  space_name: 'Engineering',
  source: 'visited',
  at: '2026-09-20T10:00:00Z',
}

const HOME = {
  pickUp: [PAGE],
  recent: [PAGE],
  recentHasMore: false,
  starredPages: [],
  starredPagesHasMore: false,
  spaces: [{ id: 7, key: 'ENG', name: 'Engineering' }],
  spacesHasMore: false,
  starredSpaces: [{ id: 7, key: 'ENG', name: 'Engineering' }],
}

const EMPTY_HOME = {
  pickUp: [], recent: [], starredPages: [], spaces: [], starredSpaces: [],
}

/*
 * Deliberately a DIFFERENT title and space from PAGE. Sharing them made every
 * getByText('Deploy runbook') match the card and the feed row at once, which
 * fails the query rather than the behaviour under test.
 */
const FEED_ITEM = {
  kind: 'page_created',
  page_id: 12,
  title: 'Rotation policy',
  space_name: 'Platform',
  actor: 'jane@x.com',
  at: '2026-09-20T10:00:00Z',
}

/** Renders the home page inside an outlet, the way the shell mounts it. */
function renderHome({ home = HOME, homeLoading = false, homeError = '' } = {}) {
  function LocationProbe() {
    const { pathname } = useLocation()
    return <span data-testid="pathname">{pathname}</span>
  }
  return render(
    <MemoryRouter initialEntries={['/wiki/home']}>
      <LocationProbe />
      <Routes>
        <Route
          path="/wiki"
          element={(
            <OutletHost value={{ home, homeLoading, homeError, reloadHome: vi.fn() }} />
          )}
        >
          <Route path="home" element={<WikiHomePage />} />
        </Route>
        <Route path="/wiki/pages/:pageId" element={<div>page view</div>} />
        <Route path="/users" element={<div>user management</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// A tiny stand-in for WikiShell that supplies the outlet context only.
function OutletHost({ value }) {
  return <Outlet context={value} />
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mockAuth.current = { authUser: { email: 'me@x.com' } }
  mockApi.fetchWikiFeed.mockResolvedValue({ items: [FEED_ITEM], hasMore: false, nextCursor: null })
  mockApi.fetchWikiHome.mockResolvedValue(HOME)
})

afterEach(() => {
  window.localStorage.clear()
})

/* ---------------------------------------------------------------- *
 * Sections with data
 * ---------------------------------------------------------------- */
describe('JL-154 the card grid is gone', () => {
  /*
   * "Pick up where you left off" was removed from the page at the user's
   * request. Recently-viewed pages still live in the sidebar's Recent section.
   * Asserted as an absence rather than deleted silently, so the grid cannot
   * quietly come back and re-take the top of the page.
   */
  it('renders no Pick up heading and no cards', async () => {
    renderHome()
    await screen.findByText(/Discover what/)
    expect(screen.queryByText('Pick up where you left off')).not.toBeInTheDocument()
    expect(document.querySelector('.wiki-card-grid')).toBeNull()
    expect(document.querySelector('.wiki-card')).toBeNull()
  })

  it('leads with the feed, which carries the page heading', async () => {
    renderHome()
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(/Discover what/)
  })

  it('renders the feed once it arrives', async () => {
    renderHome()
    await waitFor(() => expect(screen.getByText('created')).toBeInTheDocument())
    expect(screen.getByText('Rotation policy')).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- *
 * Empty states
 * ---------------------------------------------------------------- */
describe('JL-152 empty states', () => {
  it('reserves no vertical space for a section that renders nothing', async () => {
    // JL-154: a section with no data gets a line, not a screen.
    mockApi.fetchWikiFeed.mockResolvedValue({ items: [], hasMore: false, nextCursor: null })
    renderHome()
    await screen.findByText(/No activity from your team yet/)
    // The compact treatment, not the full-height EmptyState block.
    expect(document.querySelector('.wiki-compact-empty')).toBeTruthy()
    expect(document.querySelector('.wiki-feed .empty-state')).toBeNull()
  })

  it('shows the first-run state when the user has no spaces at all', async () => {
    // The one case that still earns a FULL empty state: there is genuinely
    // nothing to do on the page and the user needs somewhere to go.
    renderHome({ home: EMPTY_HOME })
    expect(await screen.findByText('Welcome to Confluence Lite')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create a space' })).toBeInTheDocument()
    // …and the feed is not also rendered underneath it.
    expect(screen.queryByText(/Discover what/)).not.toBeInTheDocument()
  })

  it('offers Invite teammates when Following has no activity', async () => {
    mockApi.fetchWikiFeed.mockResolvedValue({ items: [], hasMore: false, nextCursor: null })
    renderHome()
    expect(await screen.findByText(/No activity from your team yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite teammates' })).toBeInTheDocument()
  })

  it('routes Invite teammates to User Management', async () => {
    mockApi.fetchWikiFeed.mockResolvedValue({ items: [], hasMore: false, nextCursor: null })
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Invite teammates' }))
    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/users'))
  })

  it('shows a different, non-inviting empty state on Popular', async () => {
    mockApi.fetchWikiFeed.mockResolvedValue({ items: [], hasMore: false, nextCursor: null })
    renderHome()
    fireEvent.click(await screen.findByRole('tab', { name: 'Popular' }))
    expect(await screen.findByText(/Nothing popular yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite teammates' })).not.toBeInTheDocument()
  })

  it('shows skeletons rather than a blank column while the feed loads', async () => {
    mockApi.fetchWikiFeed.mockReturnValue(new Promise(() => {}))
    const { container } = renderHome()
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
  })
})

/* ---------------------------------------------------------------- *
 * The feed tabs
 * ---------------------------------------------------------------- */
describe('JL-152 feed tabs', () => {
  it('defaults to Following, selected', async () => {
    renderHome()
    const following = await screen.findByRole('tab', { name: 'Following' })
    expect(following).toHaveAttribute('aria-selected', 'true')
  })

  it('refetches with the new tab when Popular is pressed', async () => {
    renderHome()
    await screen.findByRole('tab', { name: 'Popular' })
    mockApi.fetchWikiFeed.mockClear()
    fireEvent.click(screen.getByRole('tab', { name: 'Popular' }))
    await waitFor(() => {
      expect(mockApi.fetchWikiFeed).toHaveBeenCalledWith(
        expect.objectContaining({ tab: 'popular' }),
      )
    })
  })

  it('changes the feed content when the tab changes', async () => {
    mockApi.fetchWikiFeed.mockImplementation(async ({ tab }) => ({
      items: [{ ...FEED_ITEM, title: tab === 'popular' ? 'Popular page' : 'Followed page' }],
      hasMore: false,
      nextCursor: null,
    }))
    renderHome()
    expect(await screen.findByText('Followed page')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Popular' }))
    expect(await screen.findByText('Popular page')).toBeInTheDocument()
    expect(screen.queryByText('Followed page')).not.toBeInTheDocument()
  })

  it('refetches when the sort changes', async () => {
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: /Sort by/ }))
    mockApi.fetchWikiFeed.mockClear()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Most recent' }))
    await waitFor(() => {
      expect(mockApi.fetchWikiFeed).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'recent' }),
      )
    })
  })
})

/* ---------------------------------------------------------------- *
 * Navigation
 * ---------------------------------------------------------------- */
describe('JL-154 feed rows navigate', () => {
  it('opens the page the row refers to', async () => {
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Rotation policy' }))
    await waitFor(() => {
      expect(screen.getByTestId('pathname').textContent).toBe('/wiki/pages/12')
    })
  })

  it('makes the title a real focusable control, not a div with a handler', async () => {
    renderHome()
    const link = await screen.findByRole('button', { name: 'Rotation policy' })
    expect(link.tagName).toBe('BUTTON')
  })
})

/* ---------------------------------------------------------------- *
 * The sidebar
 * ---------------------------------------------------------------- */
function renderSidebar(data = HOME, props = {}) {
  return render(
    <MemoryRouter initialEntries={['/wiki/home']}>
      <WikiSidebar data={data} loading={false} {...props} />
    </MemoryRouter>,
  )
}

describe('JL-152 sidebar', () => {
  it('lists the primary nav in the order the brief specifies', async () => {
    renderSidebar()
    const nav = screen.getByTestId('wiki-sidebar')
    const labels = within(nav).getAllByText(/^(For you|Recent|Starred|Spaces|Apps)$/)
      .map((el) => el.textContent)
    // JL-159 dropped "Apps". It stays in the match above so that re-adding it
    // to the panel fails here rather than passing unnoticed.
    expect(labels).toEqual(['For you', 'Recent', 'Starred', 'Spaces'])
  })

  it('does not offer Apps, in either the expanded panel or the rail', async () => {
    /*
     * JL-159. The collapsed rail carried its own Apps link, separate from the
     * expanded list — removing one and not the other is the obvious way to
     * half-do this, and it would be invisible until someone collapsed the
     * sidebar.
     */
    for (const collapsed of [false, true]) {
      const { unmount } = renderSidebar(HOME, { collapsed })
      const nav = screen.getByTestId('wiki-sidebar')
      expect(within(nav).queryByText('Apps'), `collapsed=${collapsed}`).not.toBeInTheDocument()
      expect(
        within(nav).queryByRole('link', { name: 'Apps' }),
        `collapsed=${collapsed} rail link`,
      ).not.toBeInTheDocument()
      unmount()
    }
  })

  it('expands a section in place without navigating', async () => {
    renderSidebar()
    const toggle = screen.getByRole('button', { name: /Spaces/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // A toggle, not a link: a link that does not navigate is a broken link.
    expect(toggle.tagName).toBe('BUTTON')
    // Scoped to this section's own panel — the same Space also appears in the
    // "Starred spaces" list further down.
    const panel = document.getElementById('wiki-nav-panel-spaces')
    expect(within(panel).getByText('Engineering')).toBeInTheDocument()
  })

  it('persists section expansion across a remount', async () => {
    const first = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /Spaces/ }))
    first.unmount()

    renderSidebar()
    expect(screen.getByRole('button', { name: /Spaces/ })).toHaveAttribute('aria-expanded', 'true')
  })

  /*
   * JL-153 replaced this pair. Collapse is no longer the wiki sidebar's own
   * state: there is exactly ONE collapse control, it lives in the shared top
   * bar, and it acts on whichever product sidebar is mounted. The panel keeps
   * only its section expansion — so that is what these now pin, plus the fact
   * that a second collapse control has not grown back here.
   */
  it('owns no collapse control — the top bar has the only one', async () => {
    renderSidebar()
    const panel = screen.getByTestId('wiki-sidebar')
    expect(
      within(panel).queryByRole('button', { name: /collapse sidebar|expand sidebar/i }),
    ).not.toBeInTheDocument()
  })

  it('renders as a rail when the shell says it is collapsed', async () => {
    render(
      <MemoryRouter initialEntries={['/wiki/home']}>
        <WikiSidebar data={HOME} loading={false} collapsed />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('wiki-sidebar').className).toMatch(/wiki-sidebar--collapsed/)
  })

  it('keeps one user’s panel state away from another’s', async () => {
    const first = renderSidebar()
    // Spaces starts closed; open it for this account only.
    fireEvent.click(screen.getByRole('button', { name: /Spaces/ }))
    expect(screen.getByRole('button', { name: /Spaces/ })).toHaveAttribute('aria-expanded', 'true')
    first.unmount()

    mockAuth.current = { authUser: { email: 'other@x.com' } }
    renderSidebar()
    // The other account starts from the default, not from this one's choice.
    expect(screen.getByRole('button', { name: /Spaces/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders a Space tile with the key initial', async () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /Spaces/ }))
    expect(screen.getAllByText('E').length).toBeGreaterThan(0)
  })

  // Recent is the one section that starts EXPANDED — it is the whole point of
  // the panel — so these two do not click it open first.
  it('offers Show more only when the server says there is more', async () => {
    renderSidebar({ ...HOME, recent: [PAGE], recentHasMore: true })
    expect(screen.getByRole('button', { name: /Recent/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Show more')).toBeInTheDocument()
  })

  it('omits Show more when there is not', async () => {
    renderSidebar({ ...HOME, recent: [PAGE], recentHasMore: false })
    expect(screen.queryByText('Show more')).not.toBeInTheDocument()
  })

  it('survives a payload that has not loaded yet', async () => {
    renderSidebar(null)
    expect(screen.getByTestId('wiki-sidebar')).toBeInTheDocument()
  })
})
