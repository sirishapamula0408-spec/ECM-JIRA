import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useMembers } from '../../context/MemberContext'
import './Topbar.css'
import { HeaderPanelIcon } from '../icons/HeaderPanelIcon'
import { displayNameFromEmail } from '../../utils/helpers'

export function Topbar({ onCreate }) {
  const { authUser: currentUser, handleLogout } = useAuth()
  const { theme, onThemeChange } = useTheme()
  const { profile } = useMembers()
  const navigate = useNavigate()
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false)
  const email = String(currentUser?.email || '').trim()
  const fullName = String(displayNameFromEmail(email) || profile?.full_name || 'User')
  const avatarText = (fullName || 'U').trim().charAt(0).toUpperCase() || 'U'

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
        <input className="search" placeholder="Search" />
      </div>

      <div className="top-actions top-actions-jira">
        <button className="btn btn-primary create-btn" type="button" onClick={onCreate}>
          <span className="plus-create-content">
            <span className="plus-create-symbol">+</span>
            <span>Create</span>
          </span>
        </button>
        <button className="icon-btn icon-badge" type="button" aria-label="Notifications">
          <HeaderPanelIcon name="notifications" />
          <span className="dot" />
        </button>
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
