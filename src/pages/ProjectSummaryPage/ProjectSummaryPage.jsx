import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchProjectById } from '../../api/projectApi'
import { useIssues } from '../../context/IssueContext'
import { useSprints } from '../../context/SprintContext'
import { useMembers } from '../../context/MemberContext'
import './ProjectSummaryPage.css'

const STATUS_COLORS = {
  'Backlog':     { bg: '#f4f5f7', border: '#c1c7d0', text: '#6b778c' },
  'To Do':       { bg: '#f4f5f7', border: '#6b778c', text: '#42526e' },
  'In Progress': { bg: '#deebff', border: '#0052cc', text: '#0052cc' },
  'Code Review': { bg: '#fff3e0', border: '#ff991f', text: '#ff8b00' },
  'Done':        { bg: '#e3fcef', border: '#00875a', text: '#006644' },
}

const PRIORITY_META = {
  High:   { color: '#de350b', label: 'High' },
  Medium: { color: '#ff991f', label: 'Medium' },
  Low:    { color: '#00875a', label: 'Low' },
}

const TYPE_ICONS = {
  Story: { color: '#00875a', symbol: '\u{1F4D7}' },
  Bug:   { color: '#de350b', symbol: '\u{1F41B}' },
  Task:  { color: '#0052cc', symbol: '\u2705' },
}

export function ProjectSummaryPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { issues } = useIssues()
  const { sprints } = useSprints()
  const { members } = useMembers()
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
    const counts = {}
    projectIssues.forEach((issue) => {
      counts[issue.status] = (counts[issue.status] || 0) + 1
    })
    return counts
  }, [projectIssues])

  const priorityCounts = useMemo(() => {
    const counts = { High: 0, Medium: 0, Low: 0 }
    projectIssues.forEach((issue) => {
      if (counts[issue.priority] !== undefined) counts[issue.priority]++
    })
    return counts
  }, [projectIssues])

  const typeCounts = useMemo(() => {
    const counts = {}
    projectIssues.forEach((issue) => {
      const t = issue.issueType || 'Task'
      counts[t] = (counts[t] || 0) + 1
    })
    return counts
  }, [projectIssues])

  const activeSprint = useMemo(() => {
    return sprints.find((s) => s.status === 'active')
  }, [sprints])

  const assigneeCounts = useMemo(() => {
    const counts = {}
    projectIssues.forEach((issue) => {
      const name = issue.assignee || 'Unassigned'
      counts[name] = (counts[name] || 0) + 1
    })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [projectIssues])

  const doneCount = statusCounts['Done'] || 0
  const totalCount = projectIssues.length
  const completionPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  if (loading) {
    return <section className="page ps-page"><div className="ps-loading">Loading project...</div></section>
  }
  if (error || !project) {
    return <section className="page ps-page"><div className="ps-error">{error || 'Project not found'}</div></section>
  }

  return (
    <section className="page ps-page">
      {/* Header */}
      <div className="ps-header">
        <span className="ps-avatar" style={{ background: project.avatar_color || '#0052cc' }}>
          {project.key.charAt(0)}
        </span>
        <div className="ps-header-info">
          <h1 className="ps-title">{project.name}</h1>
          <div className="ps-meta">
            <span className="ps-key-badge">{project.key}</span>
            <span className="ps-type-chip">{project.type}</span>
            <span className="ps-lead">
              <span className="ps-lead-avatar">{project.lead.charAt(0).toUpperCase()}</span>
              {project.lead}
            </span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="ps-stats-row">
        <div className="ps-stat-card">
          <span className="ps-stat-value">{totalCount}</span>
          <span className="ps-stat-label">Total Issues</span>
        </div>
        <div className="ps-stat-card ps-stat-card--done">
          <span className="ps-stat-value">{doneCount}</span>
          <span className="ps-stat-label">Done</span>
        </div>
        <div className="ps-stat-card ps-stat-card--progress">
          <span className="ps-stat-value">{completionPct}%</span>
          <span className="ps-stat-label">Complete</span>
        </div>
        <div className="ps-stat-card">
          <span className="ps-stat-value">{activeSprint ? activeSprint.name : '-'}</span>
          <span className="ps-stat-label">Active Sprint</span>
        </div>
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="ps-progress-section">
          <div className="ps-progress-header">
            <span className="ps-section-title">Progress</span>
            <span className="ps-progress-text">{doneCount} of {totalCount} issues done</span>
          </div>
          <div className="ps-progress-bar">
            <div className="ps-progress-fill" style={{ width: `${completionPct}%` }} />
          </div>
        </div>
      )}

      {/* Main content grid */}
      <div className="ps-grid">
        {/* Left column */}
        <div className="ps-col">
          {/* Status breakdown */}
          <div className="ps-card">
            <h3 className="ps-card-title">Status Breakdown</h3>
            {totalCount === 0 ? (
              <p className="ps-empty">No issues yet</p>
            ) : (
              <div className="ps-status-bars">
                {Object.entries(statusCounts).map(([status, count]) => {
                  const pct = Math.round((count / totalCount) * 100)
                  const colors = STATUS_COLORS[status] || STATUS_COLORS['To Do']
                  return (
                    <div key={status} className="ps-bar-row">
                      <span className="ps-bar-label">{status}</span>
                      <div className="ps-bar-track">
                        <div
                          className="ps-bar-fill"
                          style={{ width: `${pct}%`, background: colors.border }}
                        />
                      </div>
                      <span className="ps-bar-count" style={{ color: colors.text }}>{count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recent issues */}
          {projectIssues.length > 0 && (
            <div className="ps-card">
              <h3 className="ps-card-title">Recent Issues</h3>
              <div className="ps-issue-list">
                {projectIssues.slice(0, 8).map((issue) => {
                  const typeMeta = TYPE_ICONS[issue.issueType] || TYPE_ICONS.Task
                  const statusColors = STATUS_COLORS[issue.status] || STATUS_COLORS['To Do']
                  return (
                    <button
                      key={issue.id}
                      type="button"
                      className="ps-issue-row"
                      onClick={() => navigate(`/issues/${issue.id}`)}
                    >
                      <span className="ps-issue-type-icon" style={{ background: typeMeta.color }}>
                        {typeMeta.symbol}
                      </span>
                      <span className="ps-issue-key">{issue.key}</span>
                      <span className="ps-issue-title">{issue.title}</span>
                      <span
                        className="ps-issue-status"
                        style={{ background: statusColors.bg, color: statusColors.text }}
                      >
                        {issue.status}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="ps-col">
          {/* Priority breakdown */}
          <div className="ps-card">
            <h3 className="ps-card-title">Priority</h3>
            <div className="ps-priority-list">
              {Object.entries(PRIORITY_META).map(([priority, meta]) => (
                <div key={priority} className="ps-priority-row">
                  <span className="ps-priority-dot" style={{ background: meta.color }} />
                  <span className="ps-priority-label">{meta.label}</span>
                  <span className="ps-priority-count">{priorityCounts[priority] || 0}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Type breakdown */}
          <div className="ps-card">
            <h3 className="ps-card-title">Issue Types</h3>
            <div className="ps-type-list">
              {Object.entries(typeCounts).map(([type, count]) => {
                const meta = TYPE_ICONS[type] || TYPE_ICONS.Task
                return (
                  <div key={type} className="ps-type-row">
                    <span className="ps-type-icon">{meta.symbol}</span>
                    <span className="ps-type-label">{type}</span>
                    <span className="ps-type-count">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Team activity */}
          <div className="ps-card">
            <h3 className="ps-card-title">Top Assignees</h3>
            {assigneeCounts.length === 0 ? (
              <p className="ps-empty">No assignments</p>
            ) : (
              <div className="ps-assignee-list">
                {assigneeCounts.map(([name, count]) => (
                  <div key={name} className="ps-assignee-row">
                    <span className="ps-assignee-avatar">
                      {name.charAt(0).toUpperCase()}
                    </span>
                    <span className="ps-assignee-name">{name}</span>
                    <span className="ps-assignee-count">{count} issue{count !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className="ps-card">
            <h3 className="ps-card-title">Quick Links</h3>
            <div className="ps-quick-links">
              <button className="ps-quick-btn" type="button" onClick={() => navigate(`/projects/${projectId}/board`)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                Board
              </button>
              <button className="ps-quick-btn" type="button" onClick={() => navigate(`/projects/${projectId}/backlog`)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                Backlog
              </button>
              <button className="ps-quick-btn" type="button" onClick={() => navigate(`/projects/${projectId}/reports`)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                Reports
              </button>
              <button className="ps-quick-btn" type="button" onClick={() => navigate(`/projects/${projectId}/roadmap`)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                Roadmap
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
