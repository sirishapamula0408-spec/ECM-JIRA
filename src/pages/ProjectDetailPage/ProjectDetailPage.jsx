import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchProjectById } from '../../api/projectApi'
import { useIssues } from '../../context/IssueContext'
import './ProjectDetailPage.css'

export function ProjectDetailPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { issues } = useIssues()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchProjectById(projectId)
      .then((data) => setProject(data))
      .catch(() => setError('Project not found'))
      .finally(() => setLoading(false))
  }, [projectId])

  const projectIssues = useMemo(() => {
    const all = Array.isArray(issues) ? issues : []
    return all.filter((issue) => issue.projectId === Number(projectId))
  }, [issues, projectId])

  const statusCounts = useMemo(() => {
    const counts = { 'To Do': 0, 'In Progress': 0, 'Code Review': 0, Done: 0, Backlog: 0 }
    projectIssues.forEach((issue) => {
      if (counts[issue.status] !== undefined) counts[issue.status]++
      else counts[issue.status] = 1
    })
    return counts
  }, [projectIssues])

  if (loading) {
    return <section className="page project-detail-page"><div className="pd-loading">Loading project...</div></section>
  }

  if (error || !project) {
    return (
      <section className="page project-detail-page">
        <div className="pd-error">{error || 'Project not found'}</div>
      </section>
    )
  }

  return (
    <section className="page project-detail-page">
      <div className="pd-main">
        <div className="pd-header-row">
          <span
            className="pd-avatar"
            style={{ background: project.avatar_color || '#0052cc' }}
          >
            {project.key.charAt(0)}
          </span>
          <div>
            <h1 className="pd-title">{project.name}</h1>
            <span className="pd-key">{project.key}</span>
          </div>
        </div>

        <div className="pd-section">
          <h3 className="pd-section-title">Details</h3>
          <dl className="pd-detail-list pd-detail-list--inline">
            <div className="pd-detail-row">
              <dt>Key</dt>
              <dd><span className="pd-key-badge">{project.key}</span></dd>
            </div>
            <div className="pd-detail-row">
              <dt>Type</dt>
              <dd><span className="pd-type-chip">{project.type}</span></dd>
            </div>
            <div className="pd-detail-row">
              <dt>Lead</dt>
              <dd>
                <div className="pd-lead-cell">
                  <span className="pd-lead-avatar">
                    {project.lead.charAt(0).toUpperCase()}
                  </span>
                  {project.lead}
                </div>
              </dd>
            </div>
            <div className="pd-detail-row">
              <dt>Created</dt>
              <dd>
                {project.created_at
                  ? new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : 'Unknown'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="pd-section">
          <h3 className="pd-section-title">Issue summary</h3>
          {projectIssues.length === 0 ? (
            <p className="pd-summary-text">No issues in this project yet.</p>
          ) : (
            <div className="pd-status-grid">
              {Object.entries(statusCounts).filter(([, count]) => count > 0).map(([status, count]) => (
                <div key={status} className={`pd-status-card pd-status-card--${status.toLowerCase().replace(/\s+/g, '-')}`}>
                  <span className="pd-status-count">{count}</span>
                  <span className="pd-status-label">{status}</span>
                </div>
              ))}
              <div className="pd-status-card pd-status-card--total">
                <span className="pd-status-count">{projectIssues.length}</span>
                <span className="pd-status-label">Total</span>
              </div>
            </div>
          )}
        </div>

        {projectIssues.length > 0 && (
          <div className="pd-section">
            <h3 className="pd-section-title">Recent issues</h3>
            <div className="pd-issue-list">
              {projectIssues.slice(0, 5).map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  className="pd-issue-row"
                  onClick={() => navigate(`/issues/${issue.id}`)}
                >
                  <span className={`pd-issue-type pd-issue-type--${(issue.issueType || 'task').toLowerCase()}`} />
                  <span className="pd-issue-key">{issue.key}</span>
                  <span className="pd-issue-title">{issue.title}</span>
                  <span className={`pd-issue-status pd-issue-status--${(issue.status || '').toLowerCase().replace(/\s+/g, '-')}`}>
                    {issue.status}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pd-section">
          <h3 className="pd-section-title">Quick links</h3>
          <div className="pd-quick-links">
            <button className="pd-quick-btn" type="button" onClick={() => navigate(`/projects/${projectId}/board`)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              Board
            </button>
            <button className="pd-quick-btn" type="button" onClick={() => navigate(`/projects/${projectId}/backlog`)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              Backlog
            </button>
            <button className="pd-quick-btn" type="button" onClick={() => navigate(`/projects/${projectId}/reports`)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              Reports
            </button>
            <button className="pd-quick-btn" type="button" onClick={() => navigate(`/projects/${projectId}/roadmap`)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Roadmap
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
