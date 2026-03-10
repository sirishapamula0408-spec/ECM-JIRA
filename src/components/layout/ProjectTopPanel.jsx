import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate, matchPath } from 'react-router-dom'
import { fetchProjectById } from '../../api/projectApi'
import { TopNavIcon } from '../icons/TopNavIcon'
import './ProjectTopPanel.css'

const VIEW_LABELS = {
  board: 'Board',
  backlog: 'Backlog',
  reports: 'Reports',
  roadmap: 'Timeline',
  'active-sprint': 'Active sprints',
  list: 'List',
}

export function ProjectTopPanel({ hasProjects }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [projectName, setProjectName] = useState('')

  // Detect project context from URL
  const projectMatch = matchPath('/projects/:projectId/*', location.pathname)
  const projectId = projectMatch?.params?.projectId

  // Fetch project name when project context is detected
  useEffect(() => {
    if (!projectId) { setProjectName(''); return }
    fetchProjectById(projectId)
      .then((data) => setProjectName(data?.name || ''))
      .catch(() => setProjectName(''))
  }, [projectId])

  // Determine current view label from the URL tail
  const viewSegment = projectId
    ? location.pathname.replace(`/projects/${projectId}`, '').replace(/^\//, '')
    : ''
  const currentViewLabel = VIEW_LABELS[viewSegment] || ''

  // Build nav items — prefix with project path when a project is active
  const prefix = projectId ? `/projects/${projectId}` : ''

  const items = [
    { id: 'summary', label: 'Summary', path: projectId ? `/projects/${projectId}` : '/dashboard', icon: 'summary' },
    { id: 'timeline', label: 'Timeline', path: `${prefix}/roadmap`, icon: 'timeline' },
    { id: 'backlog', label: 'Backlog', path: `${prefix}/backlog`, icon: 'backlog' },
    { id: 'active-sprints', label: 'Active sprints', path: `${prefix}/active-sprint`, icon: 'active-sprints' },
    { id: 'reports', label: 'Reports', path: `${prefix}/reports`, icon: 'reports' },
    { id: 'list', label: 'List', path: projectId ? `${prefix}/list` : '/workflows', icon: 'list' },
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

  // Hide the navigation ribbon on the dashboard page (non-project context)
  const isDashboard = location.pathname === '/' || location.pathname === '/dashboard'
  const isProfile = location.pathname === '/profile'
  const isIssueDetail = location.pathname.startsWith('/issues/')
  if (isDashboard || isProfile || isIssueDetail || !hasProjects) return null

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
