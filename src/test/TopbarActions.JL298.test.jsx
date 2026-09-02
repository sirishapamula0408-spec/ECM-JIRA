import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

/* ================================================================
   JL-298 — Top bar actions: incorrect navigation & missing behavior
   Covers the six defects that are observable in jsdom:
     1. Notifications panel has an opaque (non-transparent) background
     2. Profile / "Account settings" de-duplicated
     3. Theme popup actually shows when triggered
     4. "Switch account" no longer silently logs out (removed)
     5. "Open Quickstart" is GONE (JL-443 removed the item entirely)
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

  // JL-443 removed the item. JL-298 had already had to redirect it once - it
  // opened /dashboard, which is not a quickstart - and repointing it at
  // /knowledge-base only made it a second, less obvious route to a page the
  // sidebar already links. The assertion inverts: it must not come back.
  it('(5) "Open Quickstart" is not in the user menu', () => {
    renderTopbar()
    openUserMenu()
    expect(screen.queryByText(/quickstart/i)).toBeNull()
    // The menu still has its real entries.
    expect(screen.getByText('Log out')).toBeInTheDocument()
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
