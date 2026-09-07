import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

/* ================================================================
   JL-298 — Top bar actions: incorrect navigation & missing behavior
   Covers the six defects that are observable in jsdom:
     1. Notifications panel has an opaque (non-transparent) background
     2. Profile / "Account settings" de-duplicated
     3. Theme popup actually shows when triggered
     4. "Switch account" no longer silently logs out (removed)
     5. "Open Quickstart" — routed to a guide rather than the dashboard.
        JL-459 later removed the item entirely; (5) now asserts its absence.
     6. Sun icon toggles theme; question-mark icon opens the help dialog
   ================================================================ */

const { mockHandleLogout } = vi.hoisted(() => ({
  mockHandleLogout: vi.fn(),
}))

// --- Auth (real logout spy so we can assert it is NOT called) ---
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    authUser: { email: 'jane@example.com' },
    handleLogout: mockHandleLogout,
  }),
}))

// --- Members / permissions / notifications / recent issues ---
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ profile: { full_name: 'Jane Doe' }, currentMember: { isOwner: false } }),
}))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ canCreateIssue: true, workspaceRole: 'Member' }),
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

// --- API modules the Topbar touches on mount ---
vi.mock('../api/issueApi', () => ({
  searchIssues: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/workspaceApi', () => ({
  fetchWorkspaces: vi.fn().mockResolvedValue([]),
  getActiveWorkspaceId: vi.fn().mockReturnValue(''),
  setActiveWorkspaceId: vi.fn(),
}))

// NB: ThemeContext is intentionally NOT mocked — we use the real provider so a
// theme toggle is observable via the <html> class it manages.
import { Topbar } from '../components/layout/Topbar'
import { ThemeProvider } from '../context/ThemeProvider'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderTopbar() {
  return render(
    <MemoryRouter initialEntries={['/board']}>
      <ThemeProvider>
        <Topbar onCreate={vi.fn()} hasProjects />
        <LocationProbe />
        <Routes>
          <Route path="*" element={null} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

function openUserMenu() {
  fireEvent.click(screen.getByLabelText('Open user menu'))
}

beforeEach(() => {
  vi.clearAllMocks()
  try { window.localStorage.setItem('jira_theme', 'light') } catch { /* ignore */ }
  document.documentElement.classList.remove('app-theme-dark')
})

// Read from disk rather than rendering the Sidebar: it pulls in the whole
// permission + context stack, and what needs guarding is that the link EXISTS,
// which is a textual property of the source.
function readSidebarSource() {
  return fs.readFileSync(path.join(process.cwd(), 'src/components/layout/Sidebar.jsx'), 'utf8')
}

describe('JL-298 Topbar actions', () => {
  it('(1) notifications panel has a non-transparent background', () => {
    const { container } = renderTopbar()
    fireEvent.click(screen.getByLabelText('Notifications'))
    const panel = container.querySelector('.notif-dropdown')
    expect(panel).toBeTruthy()
    const bg = panel.style.background || panel.style.backgroundColor
    expect(bg).toBeTruthy()
    expect(bg).not.toBe('transparent')
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
  })

  it('(2) Profile is present and the redundant "Account settings" item is gone', () => {
    renderTopbar()
    openUserMenu()
    expect(screen.getByText('Profile')).toBeInTheDocument()
    expect(screen.queryByText(/account settings/i)).toBeNull()
  })

  it('(3) theme popup shows Light/Dark options when the Theme item is clicked', () => {
    renderTopbar()
    openUserMenu()
    // Options are not rendered until the Theme item is triggered.
    expect(screen.queryByRole('menuitemradio', { name: /light/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^theme/i }))
    expect(screen.getByRole('menuitemradio', { name: /light/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /dark/i })).toBeInTheDocument()
  })

  it('(4) "Switch account" item is removed and logout is never triggered by it', () => {
    renderTopbar()
    openUserMenu()
    expect(screen.queryByText(/switch account/i)).toBeNull()
    expect(mockHandleLogout).not.toHaveBeenCalled()
    // The explicit Log out control still works.
    fireEvent.click(screen.getByText('Log out'))
    expect(mockHandleLogout).toHaveBeenCalledTimes(1)
  })

  // JL-459 INVERTED this assertion. It used to check that "Open Quickstart"
  // routed to /knowledge-base rather than /dashboard — JL-298's fix for a button
  // pointing somewhere unrelated to its label.
  //
  // The item is now gone. There was never a quickstart feature behind it: the
  // label promised guided onboarding and it opened the general Knowledge Base,
  // and having to repoint it once already was the clue that it had no
  // destination of its own. Nothing was stranded, because /knowledge-base is in
  // the sidebar.
  //
  // Kept as an assertion rather than deleted, so the menu cannot quietly regrow
  // the item.
  it('(5) no longer offers "Open Quickstart" (JL-459)', () => {
    renderTopbar()
    openUserMenu()
    expect(screen.queryByText('Open Quickstart')).toBeNull()
  })

  it('(5b) the Knowledge Base is still reachable from the sidebar (JL-459)', () => {
    // The check that stops this ticket removing the only way to a page. The
    // sidebar owns that link, which is what made the button safe to delete.
    const sidebarSource = readSidebarSource()
    expect(sidebarSource).toContain("path: '/knowledge-base'")
  })

  it('(6a) the sun icon toggles the theme (light -> dark)', async () => {
    renderTopbar()
    expect(document.documentElement.classList.contains('app-theme-dark')).toBe(false)
    fireEvent.click(screen.getByLabelText('Switch to dark theme'))
    await waitFor(() => {
      expect(document.documentElement.classList.contains('app-theme-dark')).toBe(true)
    })
    // Label flips to offer switching back.
    expect(screen.getByLabelText('Switch to light theme')).toBeInTheDocument()
  })

  it('(6b) the question-mark (help) icon opens the shortcuts dialog', async () => {
    renderTopbar()
    expect(screen.queryByText('Keyboard shortcuts')).toBeNull()
    fireEvent.click(screen.getByLabelText('Help'))
    expect(await screen.findByText('Keyboard shortcuts')).toBeInTheDocument()
  })
})
