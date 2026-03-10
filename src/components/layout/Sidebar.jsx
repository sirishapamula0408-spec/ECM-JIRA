import { useEffect, useState, useCallback } from 'react'
import { NavLink, useNavigate, useLocation, matchPath } from 'react-router-dom'
import { SidebarNavIcon } from '../icons/SidebarNavIcon'
import { fetchProjects } from '../../api/projectApi'
import sedinLogo from '../../assets/sedin-logo.svg'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Divider from '@mui/material/Divider'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Collapse from '@mui/material/Collapse'
import Avatar from '@mui/material/Avatar'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import AddIcon from '@mui/icons-material/Add'
import './Sidebar.css'

export function Sidebar({ collapsed, onToggleSidebar, onCreateProject, projectRefreshKey, hasProjects }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [isSpacesMenuOpen, setIsSpacesMenuOpen] = useState(false)
  const [spacesMenuAnchor, setSpacesMenuAnchor] = useState(null)
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

  const handleSpacesMenuOpen = (event) => {
    event.preventDefault()
    event.stopPropagation()
    setSpacesMenuAnchor(event.currentTarget)
    setIsSpacesMenuOpen(true)
  }

  const handleSpacesMenuClose = () => {
    setSpacesMenuAnchor(null)
    setIsSpacesMenuOpen(false)
  }

  /** Render a nav item as an MUI ListItemButton wrapped in NavLink */
  const renderNavItem = (item, keyPrefix = '') => {
    const isDisabled = !hasProjects && item.label !== 'Projects' && item.label !== 'Teams'

    if (isDisabled) {
      return (
        <ListItemButton
          key={`${keyPrefix}${item.label}-${item.path}`}
          disabled
          title={collapsed ? item.label : 'No project access'}
          sx={{ py: 0.5, minHeight: 36 }}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <SidebarNavIcon name={item.icon} />
          </ListItemIcon>
          {!collapsed && <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14 }} />}
        </ListItemButton>
      )
    }

    return (
      <ListItemButton
        key={`${keyPrefix}${item.label}-${item.path}`}
        component={NavLink}
        to={item.path}
        title={collapsed ? item.label : undefined}
        selected={location.pathname.startsWith(item.path)}
        sx={{ py: 0.5, minHeight: 36, '&.active': { bgcolor: 'action.selected' } }}
      >
        <ListItemIcon sx={{ minWidth: 32 }}>
          <SidebarNavIcon name={item.icon} />
        </ListItemIcon>
        {!collapsed && <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14 }} />}
      </ListItemButton>
    )
  }

  return (
    <aside className="sidebar" role="complementary" aria-label="Sidebar navigation">
      <div className="sidebar-top">
        <div className="brand jira-brand">
          <img src={sedinLogo} alt="Sedin" className="brand-logo" />
          {!collapsed && <h2>ECM Projects</h2>}
        </div>
        <IconButton size="small" aria-label="Collapse sidebar" onClick={onToggleSidebar}>
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </IconButton>
      </div>

      <nav aria-label="Main navigation">
        <List disablePadding>
          {primaryItems.filter((item) => !(spacesHidden && item.label === 'Projects')).map((item) => {
            if (item.label === 'Projects') {
              return (
                <div key={item.path} className="sidebar-projects-section">
                  <ListItemButton
                    selected={location.pathname.startsWith('/projects')}
                    sx={{ py: 0.5, minHeight: 36, '&.Mui-selected': { bgcolor: 'action.selected' } }}
                  >
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
                    <ListItemIcon
                      sx={{ minWidth: 32, cursor: 'pointer' }}
                      onClick={() => { navigate('/projects'); setProjectsExpanded(true); loadProjects() }}
                    >
                      <SidebarNavIcon name={item.icon} />
                    </ListItemIcon>
                    {!collapsed && (
                      <ListItemText
                        primary={item.label}
                        primaryTypographyProps={{ fontSize: 14, cursor: 'pointer' }}
                        onClick={() => { navigate('/projects'); setProjectsExpanded(true); loadProjects() }}
                      />
                    )}
                    {!collapsed && (
                      <span className="nav-trailing nav-trailing-actions" onClick={(event) => event.preventDefault()}>
                        <IconButton
                          size="small"
                          aria-label="Create project"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            if (onCreateProject) onCreateProject()
                          }}
                        >
                          <AddIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label="Projects actions"
                          onClick={handleSpacesMenuOpen}
                        >
                          <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 'bold' }}>...</span>
                        </IconButton>
                        <Menu
                          anchorEl={spacesMenuAnchor}
                          open={isSpacesMenuOpen}
                          onClose={handleSpacesMenuClose}
                          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                        >
                          <MenuItem
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              handleSpacesMenuClose()
                              navigate('/projects')
                            }}
                          >
                            Manage projects
                          </MenuItem>
                          <MenuItem
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setSpacesHidden(true)
                              handleSpacesMenuClose()
                            }}
                          >
                            Hide from sidebar
                          </MenuItem>
                        </Menu>
                      </span>
                    )}
                  </ListItemButton>
                  {/* Collapsible project list */}
                  <Collapse in={projectsExpanded && !collapsed} timeout="auto" unmountOnExit>
                    <List disablePadding className="sidebar-project-list">
                      {[...projects].sort((a, b) => b.id - a.id).slice(0, 4).map((project) => (
                        <ListItemButton
                          key={project.id}
                          component={NavLink}
                          to={`/projects/${project.id}/board`}
                          selected={String(project.id) === activeProjectId}
                          sx={{ py: 0.25, pl: 4, minHeight: 32 }}
                          className={String(project.id) === activeProjectId ? 'sidebar-project-item--active' : ''}
                        >
                          <ListItemIcon sx={{ minWidth: 28 }}>
                            <Avatar
                              sx={{
                                width: 20,
                                height: 20,
                                fontSize: 11,
                                bgcolor: project.avatar_color || '#0052cc',
                              }}
                            >
                              {project.key.charAt(0)}
                            </Avatar>
                          </ListItemIcon>
                          <ListItemText
                            primary={project.name}
                            secondary={project.key}
                            primaryTypographyProps={{ fontSize: 13, noWrap: true }}
                            secondaryTypographyProps={{ fontSize: 11, noWrap: true }}
                          />
                        </ListItemButton>
                      ))}
                      {projects.length > 4 && (
                        <ListItemButton
                          component={NavLink}
                          to="/projects"
                          sx={{ py: 0.25, pl: 4, minHeight: 28 }}
                        >
                          <ListItemText
                            primary="More projects..."
                            primaryTypographyProps={{ fontSize: 12, color: 'primary.main' }}
                          />
                        </ListItemButton>
                      )}
                    </List>
                  </Collapse>
                </div>
              )
            }
            return renderNavItem(item)
          })}
        </List>
      </nav>

      {!collapsed && spacesHidden && (
        <button className="btn btn-ghost restore-spaces-btn" type="button" onClick={() => setSpacesHidden(false)}>
          Show Projects
        </button>
      )}

      <Divider sx={{ my: 1 }} />

      <nav>
        <List disablePadding>
          {productItems.map((item) => renderNavItem(item, 'product-'))}
        </List>
      </nav>

      <div className="sidebar-box">
        <nav>
          <List disablePadding>
            {utilityItems.map((item) => renderNavItem(item, 'utility-'))}
          </List>
        </nav>
      </div>

    </aside>
  )
}
