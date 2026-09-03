import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate, matchPath } from 'react-router-dom'
import { fetchProjectById } from '../../api/projectApi'
import { TopNavIcon } from '../icons/TopNavIcon'
import './ProjectTopPanel.css'

// Routes with no project context — the project navigation strip is hidden on these.
// Base entries first, then page routes in alphabetical order.
const HIDDEN_ROUTES = [
  '/',
  '/dashboard',
  '/profile',
  '/issues',
  '/activity',
  '/audit-log',
  '/filters',
  '/members',
  '/portfolio',
  '/report-builder',
  '/teams',
  '/users',
]

const VIEW_LABELS = {
  board: 'Board',
  backlog: 'Backlog',
  reports: 'Reports',
  roadmap: 'Timeline',
  'active-sprint': 'Active sprints',
  list: 'List',
  wiki: 'Wiki',
  settings: 'Settings',
}

export function ProjectTopPanel({ hasProjects }) {
  const location = useLocation()
  const navigate = useNavigate()
  // JL-407: the fetched name is stored *with the id it belongs to*, and the
  // displayed name is derived by matching that id against the current URL. This
  // replaced a bare `projectName` string plus a synchronous `setProjectName('')`
  // at the top of the effect. Two things improve: the effect no longer sets
  // state during the render pass that scheduled it, and — the real bug — moving
  // from project A to project B used to leave A's name in the header until B's
  // request came back, because the clear only ran when projectId went falsy. A
  // name that does not belong to the project in the URL is now simply not shown.
  const [fetched, setFetched] = useState({ id: null, name: '' })

  // Detect project context from URL
  const projectMatch = matchPath('/projects/:projectId/*', location.pathname)
  const projectId = projectMatch?.params?.projectId

  // Fetch project name when project context is detected
  useEffect(() => {
    if (!projectId) return
    let active = true
    fetchProjectById(projectId)
      .then((data) => { if (active) setFetched({ id: projectId, name: data?.name || '' }) })
      .catch(() => { if (active) setFetched({ id: projectId, name: '' }) })
    return () => { active = false }
  }, [projectId])

  const projectName = projectId && fetched.id === projectId ? fetched.name : ''

  // Determine current view label from the URL tail
  const viewSegment = projectId
    ? location.pathname.replace(`/projects/${projectId}`, '').replace(/^\//, '')
    : ''
  const currentViewLabel = VIEW_LABELS[viewSegment] || ''

  // Build nav items — prefix with project path when a project is active
  const prefix = projectId ? `/projects/${projectId}` : ''

  // JL-456: Timeline and Wiki were removed from this strip to shorten it.
  //
  // Their ROUTES are untouched — /projects/:id/roadmap and /projects/:id/wiki
  // still render, and VIEW_LABELS below still names them in the breadcrumb, so
  // a bookmark keeps working. Only the tabs are gone.
  //
  // Both keep a way in from the project pages: Roadmap already had quick-action
  // buttons on ProjectDetailPage and ProjectSummaryPage, and JL-456 added a Wiki
  // one beside them. That mattered — this tab was the ONLY link to the wiki in
  // the whole app, so deleting it outright would have stranded JL-48 (pages,
  // versions, search, issue links, and server/routes/wiki.js) behind a URL
  // nobody could reach by clicking.
  const items = [
    { id: 'summary', label: 'Summary', path: projectId ? `/projects/${projectId}` : '/dashboard', icon: 'summary' },
    { id: 'backlog', label: 'Backlog', path: `${prefix}/backlog`, icon: 'backlog' },
    { id: 'active-sprints', label: 'Active sprints', path: `${prefix}/active-sprint`, icon: 'active-sprints' },
    { id: 'reports', label: 'Reports', path: `${prefix}/reports`, icon: 'reports' },
    { id: 'list', label: 'List', path: projectId ? `${prefix}/list` : '/list', icon: 'list' },
    // JL-222: project-scoped tabs (only shown when inside a project)
    ...(projectId
      ? [{ id: 'settings', label: 'Settings', path: `${prefix}/settings`, icon: 'settings' }]
      : []),
  ]

  const isPathActive = (path, id) => {
    if (!projectId) {
      if (id === 'summary') return location.pathname === '/dashboard'
      return location.pathname === path || location.pathname.startsWith(path + '/')
    }
    // Project-scoped: Summary is only active on exact project path
    if (id === 'summary') {
      return location.pathname === `/projects/${projectId}`
    }
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }

  // Hide the navigation ribbon on pages with no project context
  const isHiddenRoute = HIDDEN_ROUTES.some(
    (route) => location.pathname === route || (route !== '/' && location.pathname.startsWith(`${route}/`)),
  )
  if (isHiddenRoute || !hasProjects) return null

  return (
    <div className="project-top-panel-wrapper">
      {/* Breadcrumbs — shown when inside a project */}
      {projectId && projectName && (
        <nav className="project-breadcrumbs" aria-label="Breadcrumb">
          <button type="button" className="project-breadcrumb-link" onClick={() => navigate('/projects')}>Projects</button>
          <span className="project-breadcrumb-sep">/</span>
          <button type="button" className="project-breadcrumb-link" onClick={() => navigate(`/projects/${projectId}`)}>{projectName}</button>
          {currentViewLabel && (
            <>
              <span className="project-breadcrumb-sep">/</span>
              <span className="project-breadcrumb-current">{currentViewLabel}</span>
            </>
          )}
        </nav>
      )}

      {/* Navigation tabs */}
      <nav className="backlog-top-panel app-project-top-panel" aria-label="Project Views">
        {items.map((item) => (
          <NavLink
            key={item.id}
            className={() => `backlog-top-item${isPathActive(item.path, item.id) ? ' active' : ''}`}
            to={item.path}
          >
            <span className="backlog-top-icon" aria-hidden="true"><TopNavIcon name={item.icon} /></span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
