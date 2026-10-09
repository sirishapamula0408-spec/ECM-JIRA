import { useCallback, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { WikiSidebar } from '../wiki/WikiSidebar'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { fetchWikiHome } from '../../api/wikiHomeApi'

/*
 * JL-153 — the Confluence Lite product shell. Level 2, sibling of JiraLayout.
 *
 * Replaces WikiShell, which was mounted INSIDE the Jira content column and so
 * produced the bug: two product sidebars side by side, under a Jira top bar.
 * This renders at the same level as JiraLayout, never inside it, so only one
 * product sidebar can ever be mounted.
 *
 * ── It still owns the one home fetch ────────────────────────────────────────
 *
 * The sidebar's Recent, Starred and Spaces sections come from the same
 * GET /api/wiki-home payload that fills the home page's card grid. Fetching it
 * here means the sidebar is populated on /wiki/pages/123 too — not only on the
 * home page — and that moving between /wiki routes does not refetch it,
 * because this component never unmounts; only the <Outlet/> below changes.
 *
 * The fragment matters: <WikiSidebar> and <main> must be DIRECT children of
 * the `.workspace` grid in RootLayout, and a fragment adds no DOM node.
 */
export function ConfluenceLayout({ collapsed, onToggleSidebar }) {
  const [home, setHome] = useState(null)
  const [homeLoading, setHomeLoading] = useState(true)
  const [homeError, setHomeError] = useState('')

  const reloadHome = useCallback(async () => {
    setHomeLoading(true)
    setHomeError('')
    try {
      setHome(await fetchWikiHome())
    } catch (err) {
      // Say what failed. An empty sidebar reads as "you have nothing", which
      // is a different claim from "this did not load" (JL-248).
      setHomeError(err?.message || 'Could not load your Confluence Lite home.')
    } finally {
      setHomeLoading(false)
    }
  }, [])

  useEffect(() => { reloadHome() }, [reloadHome])

  return (
    <>
      {/* JL-156: creating or deleting a Space from the sidebar changes the
          very payload that drew it, so the sidebar is handed the same
          reload this layout already owns rather than keeping a second,
          divergent copy of the Spaces list. */}
      <WikiSidebar
        data={home}
        loading={homeLoading}
        collapsed={collapsed}
        onSpacesChanged={reloadHome}
      />
      <main className="content" role="main" id="main-content" tabIndex={-1}>
        <ErrorBoundary>
          {/* JL-187: the page editor's top bar carries the sidebar toggle. */}
          <Outlet context={{ home, homeLoading, homeError, reloadHome, onToggleSidebar, sidebarCollapsed: collapsed }} />
        </ErrorBoundary>
      </main>
    </>
  )
}

export default ConfluenceLayout
