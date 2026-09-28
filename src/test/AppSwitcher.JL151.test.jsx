import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

/* ================================================================
   JL-151 — app switcher (waffle) in the top navigation

   Covers, per the ticket:
     - opens, and closes by EACH of the four routes (select a row, Escape,
       outside click, pressing the trigger again)
     - keyboard: arrow navigation, Enter activates, Escape returns focus to
       the trigger
     - the app the user is currently in is marked (and is NOT disabled)
     - an app the user has no access to is ABSENT, not greyed out
     - selecting a row performs a real route change to the configured path
     - the trigger sits between the collapse control and the product name
   ================================================================ */

const { mockPermissions } = vi.hoisted(() => ({
  // Mutable so a single module mock can serve every permission scenario.
  mockPermissions: { current: {} },
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => mockPermissions.current,
}))

// --- everything else the Topbar touches, for the placement test only ---
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
    notifications: [],
    unreadCount: 0,
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    dismiss: vi.fn(),
    clearRead: vi.fn(),
    loadNotifications: vi.fn(),
  }),
}))
vi.mock('../hooks/useRecentIssues', () => ({
  useRecentIssues: () => ({ recentIssues: [] }),
}))
vi.mock('../api/issueApi', () => ({ searchIssues: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/workspaceApi', () => ({
  fetchWorkspaces: vi.fn().mockResolvedValue([]),
  getActiveWorkspaceId: vi.fn().mockReturnValue(''),
  setActiveWorkspaceId: vi.fn(),
  DEFAULT_WORKSPACE_SLUG: 'default',
}))

import { AppSwitcher } from '../components/appswitcher/AppSwitcher'
import { APP_SWITCHER_APPS, visibleApps, resolveActiveAppId } from '../components/appswitcher/appSwitcherApps'
import { Topbar } from '../components/layout/Topbar'

// A workspace Member: canCreateIssue is the capability Confluence Lite needs.
const MEMBER = { loaded: true, canCreateIssue: true, canCreateIssueAnywhere: true, workspaceRole: 'Member' }
// A workspace Viewer: no authoring rights anywhere.
const VIEWER = { loaded: true, canCreateIssue: false, canCreateIssueAnywhere: false, workspaceRole: 'Viewer' }

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderSwitcher(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppSwitcher />
      <LocationProbe />
      <Routes>
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  )
}

/*
 * Queried from the DOM rather than by role: MUI's Modal marks the rest of the
 * page aria-hidden while the menu is open (the same trade-off StatusLozenge
 * already makes app-wide), so getByRole cannot see the trigger in that state.
 * The accessible-name lookup is asserted separately, with the panel closed.
 */
function trigger() {
  return document.querySelector('button.app-switcher-trigger')
}

async function openSwitcher() {
  trigger().focus()
  fireEvent.click(trigger())
  return screen.findByRole('menu')
}

beforeEach(() => {
  mockPermissions.current = MEMBER
})

describe('AppSwitcher (JL-151) — trigger', () => {
  it('renders a grid button with menu semantics, collapsed by default', () => {
    renderSwitcher()
    const btn = screen.getByRole('button', { name: 'App switcher' })
    expect(btn).toBe(trigger())

    expect(btn).toHaveAttribute('aria-haspopup', 'menu')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(btn.tagName).toBe('BUTTON')
    // The 3x3 dot grid glyph, not a text label.
    expect(btn.querySelector('svg.app-switcher-grid-icon')).not.toBeNull()
    expect(btn.querySelectorAll('svg.app-switcher-grid-icon circle')).toHaveLength(9)
  })

  it('is focusable and opens from the keyboard (Enter activates a real button)', async () => {
    renderSwitcher()
    trigger().focus()
    expect(document.activeElement).toBe(trigger())

    // A native <button> is activated by Enter/Space by the browser itself,
    // which jsdom models as a click on the focused button.
    fireEvent.click(document.activeElement)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
  })

  it('shows a selected state while the panel is open', async () => {
    renderSwitcher()
    expect(trigger()).not.toHaveClass('app-switcher-trigger--open')

    await openSwitcher()

    expect(trigger()).toHaveClass('app-switcher-trigger--open')
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('AppSwitcher (JL-151) — panel contents', () => {
  it('lists one row per configured app, as menu items', async () => {
    const menu = await (renderSwitcher(), openSwitcher())

    const items = within(menu).getAllByRole('menuitem')
    expect(items).toHaveLength(2)
    expect(items.map((el) => el.textContent.trim())).toEqual(['JIRA Lite', 'Confluence Lite'])
  })

  it('skins the panel and the list so the stylesheet can reach them', async () => {
    renderSwitcher()
    const menu = await openSwitcher()

    // role=menu lives on the list; the sized/bordered surface is the paper.
    expect(menu).toHaveClass('app-switcher-list')
    expect(menu.closest('.app-switcher-panel')).not.toBeNull()
    expect(menu).toHaveAttribute('aria-label', 'Switch app')
  })

  it('renders an icon tile next to each name', async () => {
    renderSwitcher()
    const menu = await openSwitcher()

    for (const item of within(menu).getAllByRole('menuitem')) {
      expect(item.querySelector('.app-switcher-tile svg')).not.toBeNull()
    }
  })

  it('marks the app the user is currently in — without disabling it', async () => {
    renderSwitcher('/board')
    const menu = await openSwitcher()

    const jira = within(menu).getByRole('menuitem', { name: /JIRA Lite/ })
    const confluence = within(menu).getByRole('menuitem', { name: /Confluence Lite/ })

    expect(jira).toHaveAttribute('aria-current', 'page')
    expect(jira).toHaveClass('app-switcher-item--current')
    expect(confluence).not.toHaveAttribute('aria-current')

    // Still fully usable: not disabled, still a tab stop.
    expect(jira).not.toHaveAttribute('aria-disabled', 'true')
    expect(jira).not.toHaveClass('Mui-disabled')
  })

  it('marks Confluence Lite when the user is inside a wiki route', async () => {
    renderSwitcher('/projects/7/wiki')
    const menu = await openSwitcher()

    expect(within(menu).getByRole('menuitem', { name: /Confluence Lite/ })).toHaveAttribute('aria-current', 'page')
    expect(within(menu).getByRole('menuitem', { name: /JIRA Lite/ })).not.toHaveAttribute('aria-current')
  })

  it('omits an app the user has no access to entirely — it is not rendered disabled', async () => {
    mockPermissions.current = VIEWER
    renderSwitcher()
    const menu = await openSwitcher()

    const items = within(menu).getAllByRole('menuitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('JIRA Lite')
    expect(within(menu).queryByText('Confluence Lite')).toBeNull()
    // Nothing disabled is left behind as a teaser.
    expect(menu.querySelector('.Mui-disabled')).toBeNull()
  })
})

describe('AppSwitcher (JL-151) — closing', () => {
  it('closes and navigates when a row is selected', async () => {
    renderSwitcher('/board')
    const menu = await openSwitcher()

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Confluence Lite/ }))

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(screen.getByTestId('location')).toHaveTextContent('/wiki')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('navigates to the issue-tracker root for JIRA Lite', async () => {
    renderSwitcher('/projects/7/wiki')
    const menu = await openSwitcher()

    fireEvent.click(within(menu).getByRole('menuitem', { name: /JIRA Lite/ }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    renderSwitcher()
    const menu = await openSwitcher()

    fireEvent.keyDown(menu, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger()))
  })

  it('closes on a click outside the panel', async () => {
    renderSwitcher()
    await openSwitcher()

    const backdrop = document.querySelector('.MuiBackdrop-root')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop)

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('closes when the grid button is pressed again', async () => {
    renderSwitcher()
    await openSwitcher()

    fireEvent.click(trigger())

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('AppSwitcher (JL-151) — keyboard navigation', () => {
  it('moves between rows with ArrowDown / ArrowUp', async () => {
    renderSwitcher()
    const menu = await openSwitcher()
    const items = within(menu).getAllByRole('menuitem')

    // MUI's MenuList focuses a row on open; the trap keeps focus inside.
    await waitFor(() => expect(items).toContain(document.activeElement))
    const start = items.indexOf(document.activeElement)

    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(items[(start + 1) % items.length]))

    fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' })
    await waitFor(() => expect(document.activeElement).toBe(items[start]))
  })

  it('activates the focused row with Enter', async () => {
    renderSwitcher('/board')
    const menu = await openSwitcher()
    const items = within(menu).getAllByRole('menuitem')

    await waitFor(() => expect(items).toContain(document.activeElement))
    const confluence = within(menu).getByRole('menuitem', { name: /Confluence Lite/ })
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(confluence))

    fireEvent.keyDown(document.activeElement, { key: 'Enter' })

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/wiki'))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})

describe('AppSwitcher (JL-151) — config array', () => {
  it('drives the panel from a single declarative array', () => {
    expect(Array.isArray(APP_SWITCHER_APPS)).toBe(true)
    for (const app of APP_SWITCHER_APPS) {
      expect(app).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        route: expect.any(String),
        enabled: expect.any(Boolean),
      })
      expect(typeof app.icon).toBe('function')
    }
  })

  it('visibleApps filters on the usePermissions capability named by `requires`', () => {
    expect(visibleApps(MEMBER).map((a) => a.id)).toEqual(['jira-lite', 'confluence-lite'])
    expect(visibleApps(VIEWER).map((a) => a.id)).toEqual(['jira-lite'])
    expect(visibleApps(null).map((a) => a.id)).toEqual(['jira-lite'])
  })

  it('visibleApps drops entries switched off with enabled: false', () => {
    const parked = [{ id: 'parked', name: 'Parked', icon: () => null, route: '/x', enabled: false }]
    expect(visibleApps(MEMBER, parked)).toEqual([])
  })

  it('resolveActiveAppId maps a pathname to the owning app', () => {
    expect(resolveActiveAppId('/')).toBe('jira-lite')
    expect(resolveActiveAppId('/board')).toBe('jira-lite')
    expect(resolveActiveAppId('/projects/7')).toBe('jira-lite')
    expect(resolveActiveAppId('/wiki')).toBe('confluence-lite')
    expect(resolveActiveAppId('/wiki/42')).toBe('confluence-lite')
    expect(resolveActiveAppId('/projects/7/wiki')).toBe('confluence-lite')
  })

  it('resolveActiveAppId marks nothing when the default app is filtered out', () => {
    const onlyWiki = APP_SWITCHER_APPS.filter((a) => a.id === 'confluence-lite')
    expect(resolveActiveAppId('/board', onlyWiki)).toBeNull()
  })
})

describe('AppSwitcher (JL-151) — placement in the top bar', () => {
  it('sits after the collapse control and ahead of the search field', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/board']}>
        <Topbar onCreate={vi.fn()} hasProjects />
      </MemoryRouter>,
    )

    const left = container.querySelector('.topbar-left')
    expect(left).not.toBeNull()
    /*
     * JL-153: the waffle is the SECOND control, not the first. The single
     * sidebar-collapse control moved into the top bar ahead of it, which is
     * the order Atlassian uses — collapse, waffle, product name.
     */
    expect(left.firstElementChild).toHaveClass('topbar-collapse')
    expect(left.children[1]).toHaveClass('app-switcher')
    expect(left.querySelector('.app-switcher button')).toHaveAttribute('aria-label', 'App switcher')

    // …and it precedes the search box in document order.
    const search = container.querySelector('.topbar-search-wrap')
    expect(left.firstElementChild.compareDocumentPosition(search))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})
