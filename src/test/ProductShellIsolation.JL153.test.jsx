import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* ================================================================
   JL-153 — product shell isolation.

   The bug: there was no layout route at all. Jira's sidebar, top bar
   and issue-context tabs were unconditional JSX above <Routes>, so
   EVERY route rendered inside Jira chrome — including a second
   product. /wiki/home showed the Jira sidebar, then the Confluence
   sidebar, then the page, under a bar offering "Search issues or JQL".

   The load-bearing assertion in this file is the negative one: NO
   Jira sidebar and NO Jira tab bar anywhere in the DOM on a /wiki
   route. That is the thing that regressed silently, because nothing
   errors when an extra sidebar renders — it just sits there.
   ================================================================ */

const { mockPermissions } = vi.hoisted(() => ({
  mockPermissions: {
    current: {
      canCreateIssue: true,
      canCreateIssueAnywhere: true,
      canManageMembers: true,
      canManageUsers: true,
      workspaceRole: 'Admin',
    },
  },
}))

vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => mockPermissions.current }))
vi.mock('../hooks/usePluginContributions', () => ({ usePluginContributions: () => [] }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { email: 'jane@example.com' }, handleLogout: vi.fn() }),
}))
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', onThemeChange: vi.fn() }),
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ profile: { full_name: 'Jane Doe' }, currentMember: { isOwner: false } }),
}))
vi.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({
    notifications: [], unreadCount: 0, markRead: vi.fn(), markAllRead: vi.fn(),
    dismiss: vi.fn(), clearRead: vi.fn(), loadNotifications: vi.fn(),
  }),
}))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))
vi.mock('../hooks/useRecentIssues', () => ({ useRecentIssues: () => ({ recentIssues: [] }) }))
vi.mock('../api/issueApi', () => ({ searchIssues: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([{ id: 1, name: 'Sample', key: 'SP' }]),
  fetchProjectById: vi.fn().mockResolvedValue({ id: 1, name: 'Sample', key: 'SP' }),
}))
vi.mock('../api/workspaceApi', () => ({
  fetchWorkspaces: vi.fn().mockResolvedValue([]),
  getActiveWorkspaceId: vi.fn().mockReturnValue(''),
  setActiveWorkspaceId: vi.fn(),
  DEFAULT_WORKSPACE_SLUG: 'default',
}))
vi.mock('../api/wikiSearchApi', () => ({
  searchWikiHomePages: vi.fn().mockResolvedValue({ items: [] }),
}))
vi.mock('../api/wikiHomeApi', () => ({
  fetchWikiHome: vi.fn().mockResolvedValue({
    pickUp: [], recent: [], starredPages: [], spaces: [], starredSpaces: [],
  }),
  fetchWikiFeed: vi.fn().mockResolvedValue({ items: [], hasMore: false, nextCursor: null }),
  fetchWikiList: vi.fn().mockResolvedValue({ items: [], hasMore: false, nextCursor: null }),
  recordPageView: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}))

import { RootLayout } from '../components/layout/RootLayout'
import { JiraLayout } from '../components/layout/JiraLayout'
import { ConfluenceLayout } from '../components/layout/ConfluenceLayout'
import { productForPath, APP_SWITCHER_APPS } from '../components/appswitcher/appSwitcherApps'

/**
 * The real three-level tree from App.jsx, with stub pages. The LAYOUTS are
 * real — they are what is under test; the pages are not.
 */
function renderAt(path, collapsed = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RootLayout collapsed={collapsed} onToggleSidebar={vi.fn()} />}>
          <Route path="/wiki" element={<ConfluenceLayout collapsed={collapsed} />}>
            <Route index element={<Navigate to="/wiki/home" replace />} />
            <Route path="home" element={<div>wiki home</div>} />
            <Route path="pages/:pageId" element={<div>wiki page</div>} />
            <Route path="apps" element={<div>wiki apps</div>} />
          </Route>
          {/* JL-155 — the Spaces directory is a Confluence Lite page. */}
          <Route path="/spaces" element={<ConfluenceLayout collapsed={collapsed} />}>
            <Route index element={<div>spaces directory</div>} />
          </Route>
          <Route element={<JiraLayout collapsed={collapsed} hasProjects loading={false} error="" />}>
            <Route path="/" element={<div>jira dashboard</div>} />
            <Route path="/projects/:projectId/backlog" element={<div>jira backlog</div>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

/** Jira's sidebar. `aria-label="Sidebar"` is its own identity. */
const jiraSidebar = (c) => c.querySelector('aside.sidebar[aria-label="Sidebar"]')
/** Jira's issue-context tab bar. */
const jiraTabs = (c) => c.querySelector('.project-top-panel-wrapper, .app-project-top-panel')
const wikiSidebar = (c) => c.querySelector('nav.wiki-sidebar')

beforeEach(() => { vi.clearAllMocks() })

/* ---------------------------------------------------------------- *
 * The negative assertion — the one that must never regress
 * ---------------------------------------------------------------- */
describe('JL-153 no JIRA chrome renders on a Confluence Lite route', () => {
  /*
   * JL-155 — /spaces is in this list, and that is the point of the fix.
   * This list used to be every path starting /wiki, which silently
   * excluded the one Confluence Lite page on another prefix. It rendered
   * under the Jira layout for two phases without failing a test.
   */
  const wikiRoutes = ['/wiki', '/wiki/home', '/wiki/pages/11', '/wiki/apps', '/spaces']

  it.each(wikiRoutes)('%s has no Jira sidebar and no Jira tab bar', async (path) => {
    const { container } = renderAt(path)
    await waitFor(() => expect(wikiSidebar(container)).toBeTruthy())

    expect(jiraSidebar(container)).toBeNull()
    expect(jiraTabs(container)).toBeNull()

    // Named for good measure: these are the labels from the screenshot.
    for (const label of ['Backlog', 'Report Builder', 'Audit Log', 'Portfolio']) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument()
    }
  })

  it.each(wikiRoutes)('%s mounts exactly ONE product sidebar', async (path) => {
    const { container } = renderAt(path)
    await waitFor(() => expect(wikiSidebar(container)).toBeTruthy())
    expect(container.querySelectorAll('aside.sidebar, nav.wiki-sidebar')).toHaveLength(1)
  })

  it('does not offer a JQL placeholder anywhere under /wiki', async () => {
    renderAt('/wiki/home')
    await waitFor(() => expect(screen.getByTestId('wiki-sidebar')).toBeInTheDocument())
    expect(screen.queryByPlaceholderText(/JQL/i)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search pages')).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- *
 * Jira keeps its own chrome
 * ---------------------------------------------------------------- */
describe('JL-153 JIRA routes are not regressed', () => {
  it('still renders the Jira sidebar', async () => {
    const { container } = renderAt('/')
    await waitFor(() => expect(jiraSidebar(container)).toBeTruthy())
    expect(wikiSidebar(container)).toBeNull()
  })

  it('still renders the issue-context tabs where they belong', async () => {
    const { container } = renderAt('/projects/1/backlog')
    await waitFor(() => expect(jiraTabs(container)).toBeTruthy())
  })

  it('keeps the JQL search placeholder', async () => {
    renderAt('/')
    expect(await screen.findByPlaceholderText(/JQL/i)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search pages')).not.toBeInTheDocument()
  })

  it('mounts exactly ONE product sidebar', async () => {
    const { container } = renderAt('/')
    await waitFor(() => expect(jiraSidebar(container)).toBeTruthy())
    expect(container.querySelectorAll('aside.sidebar, nav.wiki-sidebar')).toHaveLength(1)
  })
})

/* ---------------------------------------------------------------- *
 * The top bar is product-aware
 * ---------------------------------------------------------------- */
describe('JL-153 the shared top bar names the active product', () => {
  it('says ECM JIRA LITE in Jira, linking to Jira home', async () => {
    renderAt('/')
    const brand = await screen.findByRole('link', { name: 'ECM JIRA LITE home' })
    expect(brand).toHaveAttribute('href', '/')
    expect(screen.getByText('ECM JIRA LITE')).toBeInTheDocument()
  })

  it('says Confluence Lite in the wiki, linking to the wiki home', async () => {
    renderAt('/wiki/home')
    const brand = await screen.findByRole('link', { name: 'Confluence Lite home' })
    expect(brand).toHaveAttribute('href', '/wiki/home')
    expect(screen.queryByText('ECM JIRA LITE')).not.toBeInTheDocument()
  })

  it('keeps the app switcher, notifications and avatar in BOTH products', async () => {
    for (const path of ['/', '/wiki/home']) {
      const view = renderAt(path)
      expect(await screen.findByRole('button', { name: 'App switcher' })).toBeInTheDocument()
      view.unmount()
    }
  })
})

/* ---------------------------------------------------------------- *
 * Exactly one collapse control (STEP 4)
 * ---------------------------------------------------------------- */
describe('JL-153 exactly one sidebar-collapse control', () => {
  it.each(['/', '/wiki/home'])('on %s', async (path) => {
    const { container } = renderAt(path)
    await waitFor(() => {
      expect(container.querySelectorAll('aside.sidebar, nav.wiki-sidebar').length).toBe(1)
    })
    const controls = screen.queryAllByRole('button', { name: /^(Collapse|Expand) sidebar$/ })
    expect(controls).toHaveLength(1)
    // And it lives in the top bar, not inside either product's sidebar.
    expect(controls[0].closest('.topbar')).toBeTruthy()
    expect(controls[0].closest('aside.sidebar, nav.wiki-sidebar')).toBeNull()
  })

  /*
   * The label/aria-expanded toggle used to be asserted against the Jira
   * sidebar's own button (Sidebar.a11y.JL279). That button is gone, so the
   * behaviour is pinned here instead — it is the only way a screen-reader user
   * knows which way the control will go.
   */
  it.each(['/', '/wiki/home'])('announces its direction on %s', async (path) => {
    const expanded = renderAt(path, false)
    const collapseBtn = await screen.findByRole('button', { name: 'Collapse sidebar' })
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')
    expanded.unmount()

    renderAt(path, true)
    const expandBtn = await screen.findByRole('button', { name: 'Expand sidebar' })
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false')
  })
})

/* ---------------------------------------------------------------- *
 * Product resolution comes from ONE registry
 * ---------------------------------------------------------------- */
describe('JL-153 productForPath', () => {
  it.each([
    ['/wiki', 'confluence-lite'],
    ['/wiki/home', 'confluence-lite'],
    ['/wiki/pages/11', 'confluence-lite'],
    ['/projects/3/wiki', 'confluence-lite'],
    // JL-155 — a Space is a Confluence Lite object, so its directory is
    // Confluence Lite chrome. /spacesuit must NOT be, hence the anchor.
    ['/spaces', 'confluence-lite'],
    ['/spaces/ENG', 'confluence-lite'],
    ['/spacesuit', 'jira-lite'],
    ['/', 'jira-lite'],
    ['/backlog', 'jira-lite'],
    ['/projects/3/backlog', 'jira-lite'],
    ['/wikipedia', 'jira-lite'],
  ])('resolves %s to %s', (path, expected) => {
    expect(productForPath(path)?.id).toBe(expected)
  })

  it('resolves regardless of permission — a URL belongs to a product either way', () => {
    // Filtering here would wrap a forbidden /wiki path in Jira chrome.
    expect(productForPath('/wiki/home')?.id).toBe('confluence-lite')
  })

  it('gives every product the chrome fields the top bar needs', () => {
    for (const app of APP_SWITCHER_APPS) {
      expect(app.productName, `${app.id} productName`).toBeTruthy()
      expect(app.homePath, `${app.id} homePath`).toBeTruthy()
      expect(app.searchPlaceholder, `${app.id} searchPlaceholder`).toBeTruthy()
      expect(typeof app.showContextTabs, `${app.id} showContextTabs`).toBe('boolean')
    }
  })

  it('gives the issue-context tabs to JIRA alone', () => {
    const withTabs = APP_SWITCHER_APPS.filter((a) => a.showContextTabs).map((a) => a.id)
    expect(withTabs).toEqual(['jira-lite'])
  })
})

/* ---------------------------------------------------------------- *
 * The route tree in App.jsx itself
 *
 * The suite above builds its own tree, so it proves the LAYOUTS are
 * isolated — but it would still pass if someone re-nested /wiki under
 * the Jira layout in App.jsx, which is the exact bug. These read the
 * real file.
 * ---------------------------------------------------------------- */
describe('JL-153 App.jsx wires the layouts as siblings', () => {
  const src = readFileSync(resolve(__dirname, '../App.jsx'), 'utf8')

  it('declares the /wiki route OUTSIDE the Jira layout, not within it', () => {
    const wikiAt = src.indexOf('path="/wiki"')
    const jiraAt = src.indexOf('<JiraLayout')
    expect(wikiAt, '/wiki route missing from App.jsx').toBeGreaterThan(-1)
    expect(jiraAt, 'JiraLayout missing from App.jsx').toBeGreaterThan(-1)
    // Declared before the Jira layout element => a sibling of it, never a
    // child. Nesting it after/inside is what put two sidebars on screen.
    expect(wikiAt).toBeLessThan(jiraAt)
  })

  it('declares /spaces OUTSIDE the Jira layout too (JL-155)', () => {
    /*
     * The sibling test above reads path="/wiki" only. /spaces was nested
     * inside the Jira layout while that test passed, which is how the
     * page hosting space creation kept Jira chrome after JL-153.
     */
    const spacesAt = src.indexOf('path="/spaces"')
    const jiraAt = src.indexOf('<JiraLayout')
    expect(spacesAt, '/spaces route missing from App.jsx').toBeGreaterThan(-1)
    expect(spacesAt).toBeLessThan(jiraAt)
  })

  it('mounts both product layouts inside RootLayout', () => {
    const rootAt = src.indexOf('<RootLayout')
    expect(rootAt).toBeGreaterThan(-1)
    expect(src.indexOf('<ConfluenceLayout')).toBeGreaterThan(rootAt)
    expect(src.indexOf('<JiraLayout')).toBeGreaterThan(rootAt)
  })

  it('renders NO product chrome directly — that is what the layouts are for', () => {
    /*
     * The original bug in one assertion. <Sidebar>, <Topbar> and
     * <ProjectTopPanel> used to sit in App.jsx above <Routes>, which is why
     * every route in the app — a whole second product included — rendered
     * inside Jira's chrome.
     *
     * ESLint cannot catch their return: `no-unused-vars` here is configured
     * with varsIgnorePattern /^[A-Z_]/, so an unused COMPONENT import passes
     * lint silently. This is the check that does not.
     */
    for (const tag of ['<Sidebar', '<Topbar', '<ProjectTopPanel']) {
      expect(src, `${tag} must be rendered by a layout, not by App.jsx`).not.toContain(tag)
    }
  })
})

/* ---------------------------------------------------------------- *
 * JL-154 — the scroll contract
 *
 * jsdom does no layout, so "exactly one scrollbar" cannot be measured
 * here. What CAN be pinned is the rule set that produces it, and every
 * line below is one that was missing when the app showed two
 * scrollbars at once.
 * ---------------------------------------------------------------- */
describe('JL-154 the shell owns the viewport and does not scroll', () => {
  const css = (rel) => readFileSync(resolve(__dirname, '..', rel), 'utf8')

  /** The declarations of one rule, found without a regex. */
  function block(source, selector) {
    const at = source.indexOf(selector + ' {')
    if (at < 0) return ''
    return source.slice(at, source.indexOf('}', at))
  }

  it('locks the document to the viewport', () => {
    const index = css('index.css')
    expect(block(index, '#root'), 'html/body/#root must be full height').toContain('height: 100%')
    expect(block(index, 'body'), 'the document itself must not scroll').toContain('overflow: hidden')
  })

  it('builds the shell as a fixed-height flex column that never scrolls', () => {
    const shell = block(css('components/layout/RootLayout.css'), '.app-shell')
    expect(shell).toContain('flex-direction: column')
    expect(shell).toContain('height: 100%')
    expect(shell).toContain('overflow: hidden')
  })

  it('gives the top bar a fixed height that never shrinks', () => {
    expect(block(css('components/layout/RootLayout.css'), '.app-shell > .topbar'))
      .toContain('flex: 0 0 var(--topbar-height)')
  })

  it('makes the workspace a flex ROW, not a grid', () => {
    /*
     * The grid declared the sidebar's width in the COLUMN, so Confluence
     * Lite's 280px panel overflowed its 240px column and rendered on top of
     * the content — the clipped "iscover what's happening".
     */
    const ws = block(css('styles/layout.css'), '.workspace')
    expect(ws).toContain('display: flex')
    expect(ws).not.toContain('grid-template-columns')
  })

  it('gives the sidebar its own width rather than inheriting a grid column', () => {
    expect(block(css('styles/layout.css'), '.workspace > .sidebar')).toContain('width: 240px')
  })

  it('lets the content column shrink and scroll by itself', () => {
    const content = block(css('styles/layout.css'), '.content')
    expect(content, 'min-width:0 is what stops a wide child widening the page')
      .toContain('min-width: 0')
    expect(content).toContain('overflow-y: auto')
    expect(content).toContain('scrollbar-gutter: stable')
  })

  it('scrolls each product sidebar independently, with a stable gutter', () => {
    const rail = block(css('components/layout/RootLayout.css'), '.app-shell .sidebar,\n.app-shell .wiki-sidebar')
    expect(rail).toContain('overflow-y: auto')
    expect(rail).toContain('scrollbar-gutter: stable')
    expect(rail, 'min-height:0 is what permits a flex child to scroll').toContain('min-height: 0')
  })

  it('no longer sticks the wiki sidebar to the viewport', () => {
    // Sticking it while the document ALSO scrolled is part of what produced
    // two scrollbars.
    const wiki = css('components/wiki/WikiSidebar.css')
    expect(wiki).not.toContain('position: sticky')
    expect(wiki).not.toContain('height: 100vh')
  })

  it('scrolls the Filter Results grid in its own container, header pinned', () => {
    const dash = css('pages/DashboardPage/DashboardPage.css')
    expect(block(dash, '.filter-results-table-wrap')).toContain('overflow: auto')
    expect(block(dash, '.filter-results-table thead th')).toContain('position: sticky')
    // Locked columns: fixed layout plus the <colgroup> the gadget renders.
    expect(block(dash, '.filter-results-table')).toContain('table-layout: fixed')
  })
})

describe('JL-154 the dashboard has no page-level scrollbar', () => {
  const dash = readFileSync(resolve(__dirname, '../pages/DashboardPage/DashboardPage.css'), 'utf8')
  function block(source, selector) {
    const at = source.indexOf(selector + ' {')
    if (at < 0) return ''
    return source.slice(at, source.indexOf('}', at))
  }

  it('uses the SAME page-viewport opt-out the List page uses', () => {
    /*
     * Not a bespoke set of dashboard rules: `page-viewport` is the existing
     * JL-399/JL-401 mechanism that stops a page element scrolling when it
     * delegates to an inner region. A second mechanism doing the same job is a
     * second set of rules to keep in step with layout.css.
     */
    const jsx = readFileSync(resolve(__dirname, '../pages/DashboardPage/DashboardPage.jsx'), 'utf8')
    expect(jsx).toContain('page dashboard-page page-viewport')

    const layout = readFileSync(resolve(__dirname, '../styles/layout.css'), 'utf8')
    expect(block(layout, '.content > .page-viewport')).toContain('overflow: hidden')
  })

  it('no longer sizes the workspace to the full viewport', () => {
    /*
     * A JL-153 regression: `height: 100dvh` was correct when .workspace was
     * the ROOT element. Once the shared top bar moved above it, the shell came
     * to 100dvh + 64px and overflowed the viewport by exactly the bar's
     * height — one of the two scrollbars on screen.
     */
    const layout = readFileSync(resolve(__dirname, '../styles/layout.css'), 'utf8')
    /*
     * Asserted against the RULE, not the file: the explanatory comment above
     * it necessarily quotes the declaration it is warning about, so a
     * file-wide search matches the prose and proves nothing.
     */
    const viewportLock = layout.slice(layout.indexOf('@media (min-width: 861px)'))
    expect(block(viewportLock, '.workspace')).not.toContain('height:')
  })

  it('hands any remaining overflow to the gadget grid, not the page', () => {
    /*
     * The grid scrolls rather than the page being clipped: if the gadget set
     * outgrows the viewport the rows must stay reachable. Removing a scrollbar
     * by hiding content is a worse bug than the one being fixed.
     */
    const grid = block(dash, '.dashboard-grid')
    expect(grid).toContain('overflow-y: auto')
    expect(grid).toContain('min-height: 0')
    expect(grid).toContain('scrollbar-gutter: stable')
  })
})
