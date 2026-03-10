import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProjects, deleteProject } from '../../api/projectApi'
import { usePermissions } from '../../hooks/usePermissions'
import './ProjectsPage.css'

export function ProjectsPage({ onCreateProject, projectRefreshKey, onProjectDeleted }) {
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [openMenuId, setOpenMenuId] = useState(null)
  const { canCreateProject, canDeleteProject } = usePermissions()

  useEffect(() => {
    setLoading(true)
    fetchProjects()
      .then((data) => {
        const list = Array.isArray(data) ? data : []
        setProjects(list.sort((a, b) => b.id - a.id))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectRefreshKey])

  const filtered = projects.filter((p) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      p.name.toLowerCase().includes(q) ||
      p.key.toLowerCase().includes(q) ||
      p.lead.toLowerCase().includes(q)
    )
  })

  async function handleMoveToTrash(project) {
    const confirmed = window.confirm(`Move project "${project.name}" to trash? Issues will be unlinked but not deleted.`)
    if (!confirmed) return
    await deleteProject(project.id)
    setProjects((prev) => prev.filter((p) => p.id !== project.id))
    setOpenMenuId(null)
    if (onProjectDeleted) onProjectDeleted()
  }

  return (
    <section className="page projects-page">
      <div className="projects-header">
        <h2>Projects</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label className="projects-search">
            <span className="projects-search-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {canCreateProject && onCreateProject && (
            <button className="btn btn-primary create-btn" type="button" onClick={onCreateProject}>
              <span className="plus-create-content">
                <span className="plus-create-symbol">+</span>
                <span>Create project</span>
              </span>
            </button>
          )}
        </div>
      </div>

      {!loading && projects.length === 0 && !query && (
        <div className="projects-no-access">
          <div className="projects-no-access-icon" aria-hidden="true">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#b3bac5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              <line x1="9" y1="13" x2="15" y2="13" />
            </svg>
          </div>
          <h3 className="projects-no-access-title">You're not assigned to any projects</h3>
          <p className="projects-no-access-desc">
            Ask your team admin to add you to a project, or create a new one to get started.
          </p>
          {canCreateProject && onCreateProject && (
            <button className="btn btn-primary" type="button" onClick={onCreateProject}>
              Create a project
            </button>
          )}
        </div>
      )}

      <article className="projects-table-shell" style={!loading && projects.length === 0 && !query ? { display: 'none' } : undefined}>
        {loading ? (
          <div className="projects-loading">Loading projects...</div>
        ) : filtered.length === 0 ? (
          <div className="projects-empty">
            {query ? 'No projects match your search.' : 'No projects yet. Create one to get started.'}
          </div>
        ) : (
          <table className="projects-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Type</th>
                <th>Lead</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((project) => (
                <tr key={project.id} className="projects-row-clickable" onClick={() => navigate(`/projects/${project.id}`)}>
                  <td>
                    <div className="projects-name-cell">
                      <span
                        className="projects-avatar"
                        style={{ background: project.avatar_color || '#0052cc' }}
                      >
                        {project.key.charAt(0)}
                      </span>
                      <div className="projects-name-text">
                        <strong className="projects-name-link">{project.name}</strong>
                      </div>
                    </div>
                  </td>
                  <td>{project.key}</td>
                  <td>
                    <span className="projects-type-chip">{project.type}</span>
                  </td>
                  <td>
                    <div className="projects-lead-cell">
                      <span className="projects-lead-avatar">
                        {project.lead.charAt(0).toUpperCase()}
                      </span>
                      {project.lead}
                    </div>
                  </td>
                  <td>
                    <div className="projects-action-wrap" onClick={(e) => e.stopPropagation()} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpenMenuId(null) }}>
                      <button className="icon-btn projects-action-btn" type="button" aria-label="Project actions" onClick={() => setOpenMenuId((cur) => (cur === project.id ? null : project.id))}>...</button>
                      {openMenuId === project.id && (
                        <div className="projects-action-menu" role="menu">
                          <button className="projects-action-item" type="button" onClick={() => { setOpenMenuId(null); navigate(`/projects/${project.id}/settings`) }}>Project settings</button>
                          <div className="projects-action-divider" />
                          {canDeleteProject && <button className="projects-action-item projects-action-danger" type="button" onClick={() => handleMoveToTrash(project)}>Move to trash</button>}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  )
}
