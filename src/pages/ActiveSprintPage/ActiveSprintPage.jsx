import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useIssues } from '../../context/IssueContext'
import { useSprints } from '../../context/SprintContext'
import { usePermissions } from '../../hooks/usePermissions'
import { STATUS_COLUMNS } from '../../constants'
import './ActiveSprintPage.css'

export function ActiveSprintPage() {
  const { issues, handleMove, reloadIssues } = useIssues()
  const { sprints, handleCompleteSprint } = useSprints()
  const navigate = useNavigate()
  const { projectId } = useParams()
  const { canEditIssue, canManageSprints } = usePermissions(projectId)
  const scopedIssues = projectId ? issues.filter((i) => i.projectId === Number(projectId)) : issues
  const [dragIssueId, setDragIssueId] = useState(null)
  const [dropStatus, setDropStatus] = useState('')

  const activeSprints = useMemo(() => sprints.filter((s) => s.isStarted), [sprints])

  if (activeSprints.length === 0) {
    return (
      <section className="page">
        <div className="active-sprint-empty">
          <h2>No active sprints</h2>
          <p>Start a sprint from the <Link to={projectId ? `/projects/${projectId}/backlog` : '/backlog'}>Backlog</Link> to see it here.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      {activeSprints.map((sprint, index) => (
        <SprintBoard
          key={sprint.id}
          sprint={sprint}
          issues={scopedIssues}
          handleMove={handleMove}
          handleCompleteSprint={handleCompleteSprint}
          reloadIssues={reloadIssues}
          navigate={navigate}
          dragIssueId={dragIssueId}
          setDragIssueId={setDragIssueId}
          dropStatus={dropStatus}
          setDropStatus={setDropStatus}
          showDivider={index > 0}
          canEditIssue={canEditIssue}
          canManageSprints={canManageSprints}
        />
      ))}
    </section>
  )
}

function SprintBoard({ sprint, issues, handleMove, handleCompleteSprint, reloadIssues, navigate, dragIssueId, setDragIssueId, dropStatus, setDropStatus, showDivider, canEditIssue, canManageSprints }) {
  const sprintIssues = useMemo(
    () => issues.filter((i) => i.sprintId === sprint.id && i.status !== 'Backlog'),
    [issues, sprint.id],
  )

  const grouped = useMemo(
    () => STATUS_COLUMNS.reduce((acc, status) => { acc[status] = sprintIssues.filter((i) => i.status === status); return acc }, {}),
    [sprintIssues],
  )

  const totalCount = sprintIssues.length
  const doneCount = grouped['Done']?.length || 0
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  async function onDrop(nextStatus) {
    if (!dragIssueId) return
    const issue = issues.find((i) => i.id === dragIssueId)
    if (!issue || issue.status === nextStatus) { setDragIssueId(null); setDropStatus(''); return }
    await handleMove(issue.id, nextStatus, issue.sprintId ?? null)
    setDragIssueId(null)
    setDropStatus('')
  }

  async function onComplete() {
    const ok = window.confirm(`Complete sprint "${sprint.name}"? Incomplete issues will move to the backlog.`)
    if (!ok) return
    await handleCompleteSprint(sprint.id)
    await reloadIssues()
  }

  return (
    <div className="active-sprint-section">
      {showDivider && <hr className="active-sprint-divider" />}

      <div className="active-sprint-header">
        <div className="active-sprint-header__info">
          <h2 className="active-sprint-header__name">{sprint.name}</h2>
          <span className="active-sprint-header__dates">{sprint.dateRange}</span>
        </div>
        <div className="active-sprint-header__right">
          <span className="active-sprint-header__progress-text">{doneCount} of {totalCount} done</span>
          <div className="active-sprint-header__progress-bar">
            <div className="active-sprint-header__progress-fill" style={{ width: `${pct}%` }} />
          </div>
          {canManageSprints && <button className="btn btn-primary" type="button" onClick={onComplete}>Complete sprint</button>}
        </div>
      </div>

      <div className="active-sprint-grid">
        {STATUS_COLUMNS.map((status) => (
          <article
            key={status}
            className={`active-sprint-col${dropStatus === status ? ' active-sprint-col-drop' : ''}`}
            onDragOver={(e) => { e.preventDefault(); if (dropStatus !== status) setDropStatus(status) }}
            onDrop={() => onDrop(status)}
          >
            <header>
              <h3>{status}</h3>
              <span>{grouped[status]?.length || 0}</span>
            </header>
            {grouped[status]?.map((issue) => (
              <div
                className="active-sprint-card"
                key={issue.id}
                draggable={canEditIssue}
                onDragStart={canEditIssue ? () => setDragIssueId(issue.id) : undefined}
                onDragEnd={canEditIssue ? () => { setDragIssueId(null); setDropStatus('') } : undefined}
              >
                <div className="active-sprint-card__top">
                  <span className="active-sprint-card__type">{issue.issueType === 'Bug' ? '\u{1F41B}' : issue.issueType === 'Story' ? '\u{1F4D7}' : '\u{2705}'}</span>
                  <button className="issue-link" type="button" onClick={() => navigate(`/issues/${issue.id}`)}>{issue.key}</button>
                </div>
                <h4 className="active-sprint-card__title">{issue.title}</h4>
                <div className="active-sprint-card__bottom">
                  <span className={`priority-mark priority-${(issue.priority || 'medium').toLowerCase()}`} title={issue.priority} />
                  {issue.assignee && (
                    <span className="member-avatar" title={issue.assignee}>
                      {issue.assignee.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </article>
        ))}
      </div>
    </div>
  )
}
