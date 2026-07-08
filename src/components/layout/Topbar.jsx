import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useMembers } from '../../context/MemberContext'
import { useNotifications } from '../../context/NotificationContext'
import { usePermissions } from '../../hooks/usePermissions'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import { searchIssues } from '../../api/issueApi'
import { fetchWorkspaces, getActiveWorkspaceId, setActiveWorkspaceId } from '../../api/workspaceApi'
import './Topbar.css'
import { HeaderPanelIcon } from '../icons/HeaderPanelIcon'
import { NotificationDropdown } from '../notifications/NotificationDropdown'
import { displayNameFromEmail } from '../../utils/helpers'

export function Topbar({ onCreate, hasProjects }) {
  const { authUser: currentUser, handleLogout } = useAuth()
  const { theme, onThemeChange } = useTheme()
  const { profile, currentMember } = useMembers()
  const { canCreateIssue, workspaceRole } = usePermissions()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false)
  const [isNotifOpen, setIsNotifOpen] = useState(false)
  const handleCloseNotif = useCallback(() => setIsNotifOpen(false), [])
  const email = String(currentUser?.email || '').trim()
  const fullName = String(displayNameFromEmail(email) || profile?.full_name || 'User')
  const avatarText = (fullName || 'U').trim().charAt(0).toUpperCase() || 'U'

  // JL-75 — global quick-search
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const searchWrapRef = useRef(null)

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
        {workspaces.length > 0 && (
          <label className="topbar-workspace" title="Switch workspace">
            <span className="topbar-workspace-icon" aria-hidden="true">Workspace</span>
            <select
              className="topbar-workspace-select"
              value={activeWorkspaceId}
              onChange={handleWorkspaceChange}
              aria-label="Active workspace"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={String(w.id)}>
                  {w.name}
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
            onFocus={() => { if (searchResults.length) setSearchOpen(true) }}
            aria-label="Search issues"
          />
          {searching && <CircularProgress size={16} className="topbar-search-spinner" />}
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
        {canCreateIssue && (
          <button className="btn btn-primary create-btn" type="button" onClick={onCreate} disabled={!hasProjects} title={!hasProjects ? 'No project access' : undefined}>
            <span className="plus-create-content">
              <span className="plus-create-symbol">+</span>
              <span>Create</span>
            </span>
          </button>
        )}
        <div className="topbar-notif-wrap" style={{ position: 'relative' }}>
          <button className="icon-btn icon-badge" type="button" aria-label="Notifications" onClick={() => setIsNotifOpen((c) => !c)}>
            <HeaderPanelIcon name="notifications" />
            {unreadCount > 0 && <span className="dot notif-count-dot">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            {unreadCount === 0 && <span className="dot" style={{ display: 'none' }} />}
          </button>
          <NotificationDropdown open={isNotifOpen} onClose={handleCloseNotif} />
        </div>
        <button className="icon-btn" type="button" aria-label="Help">
          <HeaderPanelIcon name="help" />
        </button>
        <button className="icon-btn" type="button" aria-label="Settings">
          <HeaderPanelIcon name="settings" />
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
            aria-label="Open user menu"
            onClick={() => setIsUserMenuOpen((current) => !current)}
          >
            {avatarText}
          </button>
          {isUserMenuOpen && (
            <div className="topbar-user-menu" role="menu">
              <div className="topbar-user-header">
                <span className="avatar topbar-user-avatar">{avatarText}</span>
                <div>
                  <strong>{fullName}</strong>
                  <small>{email || 'user@example.com'}</small>
                  {workspaceRole && (
                    <Chip
                      label={currentMember?.isOwner ? 'Owner' : workspaceRole}
                      size="small"
                      color={workspaceRole === 'Admin' ? 'primary' : workspaceRole === 'Member' ? 'default' : 'warning'}
                      sx={{ mt: 0.5, height: 20, fontSize: '0.7rem' }}
                    />
                  )}
                </div>
              </div>

              <button className="topbar-user-item" type="button" onClick={() => { setIsUserMenuOpen(false); navigate('/profile') }}>
                <span className="topbar-user-item-icon"><HeaderPanelIcon name="profile" /></span>
                Profile
              </button>
              <button className="topbar-user-item" type="button" onClick={() => { setIsUserMenuOpen(false); navigate('/profile') }}>
                <span className="topbar-user-item-icon"><HeaderPanelIcon name="account" /></span>
                Account settings
              </button>

              <div className="topbar-user-submenu-wrap">
                <button
                  className="topbar-user-item"
                  type="button"
                  onClick={() => setIsThemeMenuOpen((current) => !current)}
                >
                  <span className="topbar-user-item-icon"><HeaderPanelIcon name="theme" /></span>
                  Theme
                  <span className="topbar-user-item-arrow" aria-hidden="true">&gt;</span>
                </button>
                {isThemeMenuOpen && (
                  <div className="topbar-user-submenu" role="menu">
                    <button className="topbar-user-item" type="button" onClick={() => { onThemeChange('light'); setIsThemeMenuOpen(false); setIsUserMenuOpen(false) }}>
                      Light {theme === 'light' ? '?' : ''}
                    </button>
                    <button className="topbar-user-item" type="button" onClick={() => { onThemeChange('dark'); setIsThemeMenuOpen(false); setIsUserMenuOpen(false) }}>
                      Dark {theme === 'dark' ? '?' : ''}
                    </button>
                  </div>
                )}
              </div>

              <button className="topbar-user-item" type="button" onClick={() => { setIsUserMenuOpen(false); navigate('/dashboard') }}>
                <span className="topbar-user-item-icon"><HeaderPanelIcon name="quickstart" /></span>
                Open Quickstart
              </button>

              <div className="topbar-user-divider" />

              <button className="topbar-user-item" type="button" onClick={handleLogout}>
                <span className="topbar-user-item-icon"><HeaderPanelIcon name="switch" /></span>
                Switch account
              </button>
              <button className="topbar-user-item" type="button" onClick={handleLogout}>
                <span className="topbar-user-item-icon"><HeaderPanelIcon name="logout" /></span>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
