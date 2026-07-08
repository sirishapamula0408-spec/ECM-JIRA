import { NavLink } from 'react-router-dom'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import AddCircleIcon from '@mui/icons-material/AddCircle'
import DashboardIcon from '@mui/icons-material/Dashboard'
import PersonIcon from '@mui/icons-material/Person'
import './MobileBottomNav.css'

/**
 * MobileBottomNav (JL-60)
 * A bottom navigation bar shown only on small screens (< 768px, controlled via CSS).
 * Provides quick access to the key destinations plus a Create action.
 */
export function MobileBottomNav({ onCreate }) {
  return (
    <nav className="mobile-bottom-nav" role="navigation" aria-label="Mobile navigation">
      <NavLink
        to="/board"
        className={({ isActive }) => (isActive ? 'mobile-bottom-nav-item active' : 'mobile-bottom-nav-item')}
        aria-label="Board"
      >
        <ViewColumnIcon fontSize="small" />
        <span className="mobile-bottom-nav-label">Board</span>
      </NavLink>
      <NavLink
        to="/backlog"
        className={({ isActive }) => (isActive ? 'mobile-bottom-nav-item active' : 'mobile-bottom-nav-item')}
        aria-label="Backlog"
      >
        <FormatListBulletedIcon fontSize="small" />
        <span className="mobile-bottom-nav-label">Backlog</span>
      </NavLink>
      <button
        type="button"
        className="mobile-bottom-nav-item mobile-bottom-nav-create"
        aria-label="Create issue"
        onClick={onCreate}
      >
        <AddCircleIcon />
        <span className="mobile-bottom-nav-label">Create</span>
      </button>
      <NavLink
        to="/dashboard"
        className={({ isActive }) => (isActive ? 'mobile-bottom-nav-item active' : 'mobile-bottom-nav-item')}
        aria-label="Dashboard"
      >
        <DashboardIcon fontSize="small" />
        <span className="mobile-bottom-nav-label">Dashboard</span>
      </NavLink>
      <NavLink
        to="/profile"
        className={({ isActive }) => (isActive ? 'mobile-bottom-nav-item active' : 'mobile-bottom-nav-item')}
        aria-label="Profile"
      >
        <PersonIcon fontSize="small" />
        <span className="mobile-bottom-nav-label">Profile</span>
      </NavLink>
    </nav>
  )
}
