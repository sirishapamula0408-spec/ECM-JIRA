import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ProjectTopPanel } from './ProjectTopPanel'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { LoadingSkeleton } from '../LoadingSkeleton'

/*
 * JL-153 — the JIRA Lite product shell. Level 2, sibling of ConfluenceLayout.
 *
 * Everything Jira-specific that used to render unconditionally for the whole
 * application now renders HERE and only here:
 *
 *   <Sidebar>          the Jira navigation
 *   <ProjectTopPanel>  the Summary / Backlog / Reports / List issue tabs
 *
 * That is the actual fix for the bug. ProjectTopPanel previously decided for
 * itself whether to appear, by testing location.pathname against a
 * HIDDEN_ROUTES allow-list — so it appeared on /wiki simply because nobody had
 * added /wiki to a list in another file. Mounting it inside the Jira layout
 * makes its absence from other products structural: there is no code path that
 * renders it under /wiki, with or without anyone remembering.
 *
 * HIDDEN_ROUTES still exists and is still correct — it answers a different
 * question, which is which JIRA pages have no issue context (the dashboard,
 * a profile, the audit log). That is Jira's business and stays Jira's.
 *
 * The fragment matters: <Sidebar> and <main> must be DIRECT children of the
 * `.workspace` grid in RootLayout, and a fragment adds no DOM node.
 */
export function JiraLayout({ collapsed, onCreateProject, projectRefreshKey, hasProjects, loading, error }) {
  return (
    <>
      <Sidebar
        collapsed={collapsed}
        onCreateProject={onCreateProject}
        projectRefreshKey={projectRefreshKey}
        hasProjects={hasProjects}
      />
      <main className="content" role="main" id="main-content" tabIndex={-1}>
        <ProjectTopPanel hasProjects={hasProjects} />
        {/* `loading` and `error` are JIRA's app data — issues, sprints,
            projects. The gate belongs to the product that needs it, which is
            also why Confluence Lite no longer waits on the tracker to load
            before it will draw a wiki page. */}
        {error && <p className="banner error" role="alert">{error}</p>}
        {loading && <LoadingSkeleton />}
        {!loading && (
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        )}
      </main>
    </>
  )
}

export default JiraLayout
