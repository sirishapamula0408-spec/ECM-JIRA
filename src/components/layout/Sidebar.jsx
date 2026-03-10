import { useEffect, useState, useCallback } from 'react'
import { NavLink, useNavigate, useLocation, matchPath } from 'react-router-dom'
import { SidebarNavIcon } from '../icons/SidebarNavIcon'
import { fetchProjects } from '../../api/projectApi'
import { usePermissions } from '../../hooks/usePermissions'
import sedinLogo from '../../assets/sedin-logo.svg'
import './Sidebar.css'

export function Sidebar({ collapsed, onToggleSidebar, onCreateProject, projectRefreshKey, hasProjects }) {
  const { canCreateProject } = usePermissions()
  const navigate = useNavigate()
  const location = useLocation()
  const [isSpacesMenuOpen, setIsSpacesMenuOpen] = useState(false)
  const [projectsExpanded, setProjectsExpanded] = useState(false)
  const [projects, setProjects] = useState([])

  // Detect current project context from URL
  const projectMatch = matchPath('/projects/:projectId/*', location.pathname)
  const activeProjectId = projectMatch?.params?.projectId

  // Auto-expand when navigating to a project route
  useEffect(() => {
    if (activeProjectId) setProjectsExpanded(true)
  }, [activeProjectId])

  // Fetch projects when expanded
  const loadProjects = useCallback(() => {
    fetchProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (projectsExpanded && projects.length === 0) loadProjects()
  }, [projectsExpanded, loadProjects, projects.length])

  // Re-fetch projects when a new project is created
  useEffect(() => {
    if (projectRefreshKey > 0) {
      loadProjects()
      setProjectsExpanded(true)
    }
  }, [projectRefreshKey, loadProjects])

  const [spacesHidden, setSpacesHidden] = useState(() => {
    try {
      return window.localStorage.getItem('jira_spaces_hidden') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem('jira_spaces_hidden', spacesHidden ? '1' : '0')
    } catch {
      // Ignore storage errors.
    }
  }, [spacesHidden])

  const primaryItems = [
    { label: 'Recent', path: '/backlog', icon: 'recent' },
    { label: 'Projects', path: '/projects', icon: 'spaces', hasInlineActions: true },
  ]

  const productItems = [
    { label: 'Teams', path: '/teams', icon: 'teams' },
    { label: 'Workflows', path: '/workflow-editor', icon: 'workflow' },
  ]

  const utilityItems = [
    { label: 'Filters', path: '/filters', icon: 'filters' },
    { label: 'Dashboards', path: '/dashboard', icon: 'dashboards' },
  ]

  return (
    <aside className="sidebar" role="complementary" aria-label="Sidebar navigation">
      <div className="sidebar-top">
        <div className="brand jira-brand">
          <img src={sedinLogo} alt="Sedin" className="brand-logo" />
          {!collapsed && <h2>ECM Projects</h2>}
        </div>
        <button className="icon-btn collapse-btn" type="button" aria-label="Collapse sidebar" onClick={onToggleSidebar}>
          {collapsed ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
          )}
        </button>
      </div>

      <nav aria-label="Main navigation">
        {primaryItems.filter((item) => !(spacesHidden && item.label === 'Projects')).map((item) => {
          if (item.label === 'Projects') {
            return (
              <div key={item.path} className="sidebar-projects-section">
                <div className={`nav${location.pathname.startsWith('/projects') ? ' active' : ''}`}>
                  <span
                    className="sidebar-caret-btn"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setProjectsExpanded((c) => !c); loadProjects() }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setProjectsExpanded((c) => !c); loadProjects() } }}
                    aria-label={projectsExpanded ? 'Collapse projects' : 'Expand projects'}
                  >
                    <span className={`sidebar-caret${projectsExpanded ? ' sidebar-caret--open' : ''}`} aria-hidden="true" />
                  </span>
                  <button
                    type="button"
                    className="sidebar-projects-toggle"
                    onClick={() => { navigate('/projects'); setProjectsExpanded(true); loadProjects() }}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="nav-icon" aria-hidden="true">
                      <SidebarNavIcon name={item.icon} />
                    </span>
                    {!collapsed && <span className="nav-label">{item.label}</span>}
                  </button>
                  {!collapsed && (
                    <span className="nav-trailing nav-trailing-actions" onClick={(event) => event.preventDefault()}>
                      {canCreateProject && (
                        <button
                          className="inline-action-btn"
                          type="button"
                          aria-label="Create project"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            if (onCreateProject) onCreateProject()
                          }}
                        >
                          +
                        </button>
                      )}
                      <span
                        className="spaces-menu-wrap"
                        onBlur={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget)) {
                            setIsSpacesMenuOpen(false)
                          }
                        }}
                      >
                        <button
                          className="inline-action-btn"
                          type="button"
                          aria-label="Projects actions"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            setIsSpacesMenuOpen((current) => !current)
                          }}
                        >
                          ...
                        </button>
                        {isSpacesMenuOpen && (
                          <div className="spaces-menu" role="menu">
                            <button
                              className="spaces-menu-item"
                              type="button"
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                setIsSpacesMenuOpen(false)
                                navigate('/projects')
                              }}
                            >
                              Manage projects
                            </button>
                            <button
                              className="spaces-menu-item"
                              type="button"
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                setSpacesHidden(true)
                                setIsSpacesMenuOpen(false)
                              }}
                            >
                              Hide from sidebar
                            </button>
                          </div>
                        )}
                      </span>
                    </span>
                  )}
                </div>
                {/* Collapsible project list */}
                {projectsExpanded && !collapsed && (
                  <div className="sidebar-project-list">
                    {[...projects].sort((a, b) => b.id - a.id).slice(0, 4).map((project) => (
                      <NavLink
                        key={project.id}
                        className={`sidebar-project-item${String(project.id) === activeProjectId ? ' sidebar-project-item--active' : ''}`}
                        to={`/projects/${project.id}/board`}
                      >
                        <span
                          className="sidebar-project-avatar"
                          style={{ background: project.avatar_color || '#0052cc' }}
                        >
                          {project.key.charAt(0)}
                        </span>
                        <span className="sidebar-project-name">{project.name}</span>
                        <span className="sidebar-project-key">{project.key}</span>
                      </NavLink>
                    ))}
                    {projects.length > 4 && (
                      <NavLink className="sidebar-project-list-more" to="/projects">
                        More projects...
                      </NavLink>
                    )}
                  </div>
                )}
              </div>
            )
          }
          const isDisabled = !hasProjects && item.label !== 'Projects'
          return isDisabled ? (
            <span key={item.path} className="nav nav-disabled" title={collapsed ? item.label : 'No project access'}>
              <span className="nav-icon" aria-hidden="true">
                <SidebarNavIcon name={item.icon} />
              </span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </span>
          ) : (
            <NavLink
              key={item.path}
              className={({ isActive }) => (isActive ? 'nav active' : 'nav')}
              to={item.path}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                <SidebarNavIcon name={item.icon} />
              </span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </NavLink>
          )
        })}
      </nav>

      {!collapsed && spacesHidden && (
        <button className="btn btn-ghost restore-spaces-btn" type="button" onClick={() => setSpacesHidden(false)}>
          Show Projects
        </button>
      )}

      <div className="sidebar-divider" />

      <nav>
        {productItems.map((item) => {
          const isAllowed = hasProjects || item.label === 'Teams'
          return isAllowed ? (
            <NavLink
              key={`${item.label}-${item.path}`}
              className={({ isActive }) => (isActive ? 'nav active' : 'nav')}
              to={item.path}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                <SidebarNavIcon name={item.icon} />
              </span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </NavLink>
          ) : (
            <span key={`${item.label}-${item.path}`} className="nav nav-disabled" title="No project access">
              <span className="nav-icon" aria-hidden="true">
                <SidebarNavIcon name={item.icon} />
              </span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </span>
          )
        })}
      </nav>

      <div className="sidebar-box">
        <nav>
          {utilityItems.map((item) => hasProjects ? (
            <NavLink
              key={`${item.label}-${item.path}`}
              className={({ isActive }) => (isActive ? 'nav active' : 'nav')}
              to={item.path}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                <SidebarNavIcon name={item.icon} />
              </span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </NavLink>
          ) : (
            <span key={`${item.label}-${item.path}`} className="nav nav-disabled" title="No project access">
              <span className="nav-icon" aria-hidden="true">
                <SidebarNavIcon name={item.icon} />
              </span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </span>
          ))}
        </nav>
      </div>

    </aside>
  )
}
