import { useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import { usePermissions } from '../../hooks/usePermissions'
import { APP_SWITCHER_APPS, visibleApps, resolveActiveAppId } from './appSwitcherApps'
import { AppSwitcherGridIcon, AppSwitcherCheckIcon } from './AppSwitcherIcons'
import './AppSwitcher.css'

/**
 * JL-151 — the Atlassian-style "waffle" app switcher.
 *
 * WHY MUI <Menu> AND NOT A NEW POPOVER. Four in-repo dropdowns were considered:
 *
 *   - NotificationDropdown — a plain absolutely-positioned <div>. It closes on
 *     outside mousedown and nothing else: no Escape, no focus trap, no arrow
 *     keys, no focus restoration, no viewport flipping. Reusing it would have
 *     meant writing all of that here anyway, i.e. a second popover.
 *   - .gadget-size-menu (GadgetWrapper) and .id-parent-picker
 *     (IssueDetailPage) — inline markup local to one component, not components
 *     at all, with the same gaps.
 *   - MUI <Menu>, already used by StatusLozenge (JL-384) — supplies, for free
 *     and already exercised by that component's test suite, every behaviour
 *     this ticket asks for: role=menu / role=menuitem, roving arrow-key focus,
 *     Escape-closes-and-restores-focus-to-the-trigger, outside click via the
 *     Modal backdrop, a focus trap, and repositioning so the panel stays inside
 *     a narrow viewport.
 *
 * So: MUI <Menu>, configured exactly the way StatusLozenge configures it
 * (`transitionDuration={0}`, bottom-left anchor), with the panel and rows
 * skinned in AppSwitcher.css from the shared tokens. There is no new dropdown
 * implementation in this change.
 *
 * The list itself comes from APP_SWITCHER_APPS — see appSwitcherApps.js.
 */
export function AppSwitcher() {
  const [anchorEl, setAnchorEl] = useState(null)
  const triggerRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  const permissions = usePermissions()

  // Entitlement filter. An app the user cannot reach is not rendered at all.
  const apps = useMemo(
    () => visibleApps(permissions, APP_SWITCHER_APPS),
    [permissions],
  )
  const activeAppId = resolveActiveAppId(location.pathname, apps)

  const open = Boolean(anchorEl)

  function handleToggle() {
    // Toggle rather than open: in a browser the Modal backdrop swallows the
    // second click and closes the menu before it reaches the button, but the
    // button must also close it when the click does land (keyboard activation,
    // and jsdom, which does no hit-testing).
    setAnchorEl((current) => (current ? null : triggerRef.current))
  }

  function handleClose() {
    setAnchorEl(null)
  }

  function handleSelect(app) {
    handleClose()
    navigate(app.route)
  }

  // Nothing to switch between is not a reason to show a switcher.
  if (apps.length === 0) return null

  return (
    <div className="app-switcher">
      <button
        ref={triggerRef}
        type="button"
        className={`icon-btn app-switcher-trigger${open ? ' app-switcher-trigger--open' : ''}`}
        aria-label="App switcher"
        title="App switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={handleToggle}
      >
        <AppSwitcherGridIcon />
      </button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        autoFocus
        transitionDuration={0}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { className: 'app-switcher-panel' } }}
        MenuListProps={{ className: 'app-switcher-list', 'aria-label': 'Switch app' }}
      >
        {apps.map((app) => {
          const Icon = app.icon
          const isCurrent = app.id === activeAppId
          return (
            <MenuItem
              key={app.id}
              className={`app-switcher-item${isCurrent ? ' app-switcher-item--current' : ''}`}
              data-app-id={app.id}
              // aria-current, not aria-disabled: the row stays fully usable.
              aria-current={isCurrent ? 'page' : undefined}
              onClick={() => handleSelect(app)}
            >
              <span className="app-switcher-tile" aria-hidden="true">
                <Icon />
              </span>
              <span className="app-switcher-name">{app.name}</span>
              {isCurrent && <AppSwitcherCheckIcon />}
            </MenuItem>
          )
        })}
      </Menu>
    </div>
  )
}
