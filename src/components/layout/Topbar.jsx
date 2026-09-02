import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useMembers } from '../../context/MemberContext'
import { useNotifications } from '../../context/NotificationContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useRecentIssues } from '../../hooks/useRecentIssues'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import { searchIssues } from '../../api/issueApi'
import { fetchWorkspaces, getActiveWorkspaceId, setActiveWorkspaceId, DEFAULT_WORKSPACE_SLUG } from '../../api/workspaceApi'
import './Topbar.css'
import { HeaderPanelIcon } from '../icons/HeaderPanelIcon'
import { NotificationDropdown } from '../notifications/NotificationDropdown'
import { KeyboardShortcutsDialog } from '../shortcuts/KeyboardShortcutsDialog'
import { displayNameFromEmail } from '../../utils/helpers'
import { avatarStyle } from '../../utils/avatarColour'

export function Topbar({ onCreate, hasProjects }) {
  const { authUser: currentUser, handleLogout } = useAuth()
  const { theme, onThemeChange } = useTheme()
  const { profile, currentMember } = useMembers()
  // JL-295: gate the global Create button on canCreateIssueAnywhere (workspace
  // rank OR any project role >= Member) — canCreateIssue without a projectId
  // only reflects workspace rank and hides Create from project Members/Leads
  // who are workspace Viewers.
  const { canCreateIssueAnywhere, workspaceRole } = usePermissions()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false)
  const [isNotifOpen, setIsNotifOpen] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const handleCloseNotif = useCallback(() => setIsNotifOpen(false), [])
  // JL-298: sun icon toggles between light/dark themes.
  const toggleTheme = useCallback(() => {
    onThemeChange(theme === 'dark' ? 'light' : 'dark')
  }, [onThemeChange, theme])
  const email = String(currentUser?.email || '').trim()
  const fullName = String(displayNameFromEmail(email) || profile?.full_name || 'User')
  const avatarText = (fullName || 'U').trim().charAt(0).toUpperCase() || 'U'
  // JL-386: the signed-in user's own avatar colour, derived from their identity
  // like everyone else's so they recognise themselves across pages.
  const ownAvatarStyle = avatarStyle(currentUser)

  // JL-75 — global quick-search
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const searchWrapRef = useRef(null)

  // JL-163 — recently viewed issues, shown when the search box is focused and empty
  const { recentIssues } = useRecentIssues()

  useEffect(() => {
    const term = searchTerm.trim()
    if (!term) {
      setSearchResults([])
      setSearching(false)
      return undefined
    }
    setSearching(true)
    let cancelled = false
    // JQL-lite queries contain an operator; otherwise treat as free text.
    const isJql = /[a-zA-Z_]+\s*(!=|=|~)/.test(term)
    const timer = setTimeout(async () => {
      try {
        const results = await searchIssues(isJql ? { jql: term } : { q: term })
        if (!cancelled) {
          setSearchResults(Array.isArray(results) ? results.slice(0, 8) : [])
          setSearchOpen(true)
        }
      } catch {
        if (!cancelled) setSearchResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searchTerm])

  const handleSelectResult = useCallback(
    (issue) => {
      setSearchOpen(false)
      setSearchTerm('')
      navigate(`/issues/${issue.id}`)
    },
    [navigate],
  )

  // JL-73 — workspace indicator / switcher
  const [workspaces, setWorkspaces] = useState([])
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState(getActiveWorkspaceId() || '')
  useEffect(() => {
    let cancelled = false
    fetchWorkspaces()
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return
        setWorkspaces(rows)
        // Default the selector to the stored id, else the first workspace.
        const stored = getActiveWorkspaceId()
        const valid = stored && rows.some((w) => String(w.id) === String(stored))
        const nextId = valid ? stored : rows[0] ? String(rows[0].id) : ''
        setActiveWorkspaceIdState(nextId)
        if (nextId && nextId !== stored) setActiveWorkspaceId(nextId)
      })
      .catch(() => { /* workspaces are best-effort; ignore */ })
    return () => { cancelled = true }
  }, [])

  const handleWorkspaceChange = useCallback((e) => {
    const id = e.target.value
    setActiveWorkspaceIdState(id)
    setActiveWorkspaceId(id)
    // Re-fetch app data under the newly selected workspace context.
    window.location.reload()
  }, [])

  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const liveDate = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const liveTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <header className="topbar">
      <div className="topbar-left">
        {/* JL-445: only render the switcher when there is something to switch
            TO. With a single workspace this was a label plus a dropdown holding
            one option - about 200px of header offering no choice - and it
            squeezed the search field, which is the control people actually use.

            Gated rather than deleted, deliberately. JL-73 built multi-tenant
            support and this is the ONLY place in the app that calls
            setActiveWorkspaceId, so removing the markup would strand a second
            workspace with no way to reach it. "> 1" hides it today and brings
            it back by itself the moment one is created. */}
        {workspaces.length > 1 && (
          <label className="topbar-workspace" title="Switch workspace">
            <span className="topbar-workspace-icon" aria-hidden="true">Workspace</span>
            <select
              className="topbar-workspace-select"
              value={activeWorkspaceId}
              onChange={handleWorkspaceChange}
              aria-label="Active workspace"
            >
              {/* JL-297: clearly mark the seeded default workspace */}
              {workspaces.map((w) => (
                <option key={w.id} value={String(w.id)}>
                  {w.slug === DEFAULT_WORKSPACE_SLUG ? `${w.name} (default)` : w.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div
          className="topbar-search-wrap"
          ref={searchWrapRef}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false)
          }}
        >
          <input
            className="search"
            placeholder="Search issues or JQL (e.g. status = Done AND priority = High)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => { if (searchResults.length || recentIssues.length) setSearchOpen(true) }}
            aria-label="Search issues"
          />
          {searching && <CircularProgress size={16} className="topbar-search-spinner" />}
          {searchOpen && !searchTerm.trim() && recentIssues.length > 0 && (
            <div className="topbar-search-results" role="listbox" aria-label="Recently viewed issues">
              <div className="topbar-search-section-label">Recent</div>
              {recentIssues.map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="topbar-search-item"
                  onClick={() => handleSelectResult(issue)}
                >
                  <span className="topbar-search-key">{issue.key}</span>
                  <span className="topbar-search-title">{issue.title}</span>
                </button>
              ))}
            </div>
          )}
          {searchOpen && searchTerm.trim() && (
            <div className="topbar-search-results" role="listbox">
              {searchResults.length === 0 && !searching && (
                <div className="topbar-search-empty">No matching issues</div>
              )}
              {searchResults.map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="topbar-search-item"
                  onClick={() => handleSelectResult(issue)}
                >
                  <span className="topbar-search-key">{issue.key}</span>
                  <span className="topbar-search-title">{issue.title}</span>
                  <span className="topbar-search-status">{issue.status}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="top-actions top-actions-jira">
        {canCreateIssueAnywhere && (
          <button className="btn btn-primary create-btn" type="button" onClick={onCreate} disabled={!hasProjects} title={!hasProjects ? 'No project access' : undefined}>
            <span className="plus-create-content">
              <span className="plus-create-symbol">+</span>
              <span>Create</span>
            </span>
          </button>
        )}
        <div className="topbar-notif-wrap" style={{ position: 'relative' }}>
          <button className="icon-btn icon-badge" type="button" aria-label="Notifications" title="Notifications" onClick={() => setIsNotifOpen((c) => !c)}>
            <HeaderPanelIcon name="notifications" />
            {unreadCount > 0 && <span className="dot notif-count-dot">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            {unreadCount === 0 && <span className="dot" style={{ display: 'none' }} />}
          </button>
          <NotificationDropdown open={isNotifOpen} onClose={handleCloseNotif} />
        </div>
        <button className="icon-btn" type="button" aria-label="Help" title="Help" onClick={() => setIsHelpOpen(true)}>
          <HeaderPanelIcon name="help" />
        </button>
        <button
          className="icon-btn"
          type="button"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-pressed={theme === 'dark'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={toggleTheme}
        >
          <HeaderPanelIcon name={theme === 'dark' ? 'sun' : 'theme'} />
        </button>
        <div className="topbar-live-clock">
          <span className="topbar-clock-time">{liveTime}</span>
          <span className="topbar-clock-date">{liveDate}</span>
        </div>
        <div
          className="topbar-user-wrap"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setIsThemeMenuOpen(false)
              setIsUserMenuOpen(false)
            }
          }}
        >
          <button
            className="avatar avatar-btn"
            type="button"
            style={ownAvatarStyle}
            aria-label="Open user menu"
            title="Open user menu"
            onClick={() => setIsUserMenuOpen((current) => !current)}
          >
            {avatarText}
          </button>
          {isUserMenuOpen && (
            <div className="topbar-user-menu" role="menu">
              <div className="topbar-user-header">
                <span className="avatar topbar-user-avatar" style={ownAvatarStyle}>{avatarText}</span>
                <div>
                  <strong>{fullName}</strong>
                  <small>{email || 'user@example.com'}</small>
                  {workspaceRole && (
                    <Chip
                      label={currentMember?.isOwner ? 'Owner' : workspaceRole}
                      size="small"
                      color={workspaceRole === 'Admin' ? 'primary' : workspaceRole === 'Member' ? 'default' : 'warning'}
                      sx={{ mt: 0.5, height: 20, fontSize: 'var(--font-size-sm)' }}
                    />
                  )}
                </div>
              </div>

              {/* JL-298: Profile and "Account settings" both routed to /profile
                  (redundant). Profile is the account page in this app, so the
                  duplicate item was removed and Profile kept. */}
              <button className="topbar-user-item" type="button" onClick={() => { setIsUserMenuOpen(false); navigate('/profile') }}>
                <span className="topbar-user-item-icon"><HeaderPanelIcon name="profile" /></span>
                Profile
              </button>

              {/* JL-298: the theme options previously rendered as an absolutely
                  positioned flyout inside a container with overflow:hidden, so
                  they were clipped and never visible. Render them inline instead. */}
              <div className="topbar-user-submenu-wrap">
                <button
                  className="topbar-user-item"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={isThemeMenuOpen}
                  onClick={() => setIsThemeMenuOpen((current) => !current)}
                >
                  <span className="topbar-user-item-icon"><HeaderPanelIcon name="theme" /></span>
                  Theme
                  <span className="topbar-user-item-arrow" aria-hidden="true">{isThemeMenuOpen ? '⌄' : '›'}</span>
                </button>
                {isThemeMenuOpen && (
                  <div className="topbar-user-submenu topbar-user-submenu--inline" role="menu">
                    <button className="topbar-user-item topbar-user-subitem" type="button" role="menuitemradio" aria-checked={theme === 'light'} onClick={() => { onThemeChange('light'); setIsThemeMenuOpen(false); setIsUserMenuOpen(false) }}>
                      Light {theme === 'light' ? '✓' : ''}
                    </button>
                    <button className="topbar-user-item topbar-user-subitem" type="button" role="menuitemradio" aria-checked={theme === 'dark'} onClick={() => { onThemeChange('dark'); setIsThemeMenuOpen(false); setIsUserMenuOpen(false) }}>
                      Dark {theme === 'dark' ? '✓' : ''}
                    </button>
                  </div>
                )}
              </div>

              {/* JL-298: quickstart previously opened /dashboard; route it to the
                  knowledge base (help/guide surface) instead. */}
              <button className="topbar-user-item" type="button" onClick={() => { setIsUserMenuOpen(false); navigate('/knowledge-base') }}>
                <span className="topbar-user-item-icon"><HeaderPanelIcon name="quickstart" /></span>
                Open Quickstart
              </button>

              <div className="topbar-user-divider" />

              {/* JL-298: a "Switch account" item that just called handleLogout was
                  deceptive — this app has no multi-account switching. It was
                  removed rather than silently logging the user out. Log out below
                  is the only session-ending action. */}
              <button className="topbar-user-item" type="button" onClick={handleLogout}>
                <span className="topbar-user-item-icon"><HeaderPanelIcon name="logout" /></span>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
      {/* JL-298: the question-mark icon opens the keyboard-shortcuts / help dialog. */}
      <KeyboardShortcutsDialog open={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </header>
  )
}
