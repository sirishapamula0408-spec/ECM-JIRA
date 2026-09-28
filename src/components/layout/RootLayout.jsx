import { Outlet, useLocation } from 'react-router-dom'
import { SkipToContent } from '../common/SkipToContent'
import { Topbar } from './Topbar'
import { ProductProvider } from '../../context/ProductProvider'
import { productForPath } from '../appswitcher/appSwitcherApps'
import './RootLayout.css'

/*
 * JL-153 — the global shell. Level 1 of three.
 *
 * ── What went wrong before ──────────────────────────────────────────────────
 *
 * There was no layout route at all. The Jira sidebar, top bar and issue tabs
 * were unconditional JSX sitting ABOVE <Routes> in App.jsx, so every route in
 * the application — including a whole second product — rendered inside Jira
 * chrome. Confluence Lite's own sidebar landed in the content column next to
 * Jira's, and the top bar kept offering "Search issues or JQL" on a wiki page.
 *
 * ── The three levels ────────────────────────────────────────────────────────
 *
 *   RootLayout        global chrome only — the top bar, which carries the app
 *                     switcher, search slot, Create, notifications, help and
 *                     the user avatar. No product navigation whatsoever.
 *     JiraLayout      Jira sidebar + issue-context tabs. Jira routes only.
 *     ConfluenceLayout  Confluence sidebar. /wiki/* only.
 *
 * The two product layouts are SIBLINGS. Neither is reachable from inside the
 * other, so "exactly one product sidebar is mounted" is a structural property
 * of the route tree rather than something each component has to be careful
 * about.
 *
 * ── Why the product is resolved HERE ────────────────────────────────────────
 *
 * The top bar is shared chrome and therefore lives above both product layouts.
 * React context flows down, so a product layout mounted inside <Outlet/> below
 * cannot hand its identity back up to the bar. The product is resolved once,
 * at this level, from the single registry in appSwitcherApps.js that the app
 * switcher already uses — not by string-matching the URL inside Topbar,
 * ProjectTopPanel or anywhere else. One list, one rule; adding a product means
 * adding one entry.
 */
export function RootLayout({ collapsed, onToggleSidebar }) {
  const { pathname } = useLocation()
  const product = productForPath(pathname)

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <SkipToContent />
      <ProductProvider product={product}>
        <Topbar collapsed={collapsed} onToggleSidebar={onToggleSidebar} />
        {/* `.workspace` keeps its existing two-column grid, so every
            `.workspace.sidebar-collapsed .sidebar` rule in the stylesheet goes
            on working untouched. The product layout below renders the sidebar
            and <main> as a fragment, which makes them direct grid children. */}
        <div className={`workspace${collapsed ? ' sidebar-collapsed' : ''}`}>
          <Outlet />
        </div>
      </ProductProvider>
    </div>
  )
}

export default RootLayout
