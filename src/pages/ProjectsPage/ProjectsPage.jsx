import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProjects, deleteProject } from '../../api/projectApi'
import { fetchFavorites, favoriteProject, unfavoriteProject } from '../../api/favoriteApi'
import './ProjectsPage.css'
import { usePageTitle } from '../../hooks/usePageTitle'

export function ProjectsPage({ onCreateProject, projectRefreshKey, onProjectDeleted }) {
  usePageTitle('Projects')
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [openMenuId, setOpenMenuId] = useState(null)
  const [favorites, setFavorites] = useState(() => new Set())

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

  useEffect(() => {
    fetchFavorites()
      .then((data) => setFavorites(new Set(data?.projectIds || [])))
      .catch(() => {})
  }, [])

  async function toggleFavorite(project) {
    const isFav = favorites.has(project.id)
    // Optimistic update
    setFavorites((prev) => {
      const next = new Set(prev)
      if (isFav) next.delete(project.id)
      else next.add(project.id)
      return next
    })
    try {
      if (isFav) await unfavoriteProject(project.id)
      else await favoriteProject(project.id)
    } catch {
      // Revert on failure
      setFavorites((prev) => {
        const next = new Set(prev)
        if (isFav) next.add(project.id)
        else next.delete(project.id)
        return next
      })
    }
  }

  const filtered = projects
    .filter((p) => {
      const q = query.trim().toLowerCase()
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q) ||
        p.lead.toLowerCase().includes(q)
      )
    })
    // Favorited projects first, preserving existing order within each group
    .sort((a, b) => {
      const fa = favorites.has(a.id) ? 1 : 0
      const fb = favorites.has(b.id) ? 1 : 0
      return fb - fa
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
          {onCreateProject && (
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
          {onCreateProject && (
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
                <th aria-label="Favorite"></th>
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
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={`projects-star-btn${favorites.has(project.id) ? ' is-favorite' : ''}`}
                      aria-label={favorites.has(project.id) ? 'Unstar project' : 'Star project'}
                      aria-pressed={favorites.has(project.id)}
                      title={favorites.has(project.id) ? 'Remove from favorites' : 'Add to favorites'}
                      onClick={() => toggleFavorite(project)}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill={favorites.has(project.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                  </td>
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
                          <button className="projects-action-item projects-action-danger" type="button" onClick={() => handleMoveToTrash(project)}>Move to trash</button>
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
