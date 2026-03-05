import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useIssues } from '../../context/IssueContext'
import { ISSUE_STATUSES, STATUS_COLUMNS } from '../../constants'
import './BoardPage.css'

export function BoardPage() {
  const { issues, handleMove } = useIssues()
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [dragIssueId, setDragIssueId] = useState(null)
  const [dropStatus, setDropStatus] = useState('')
  const [isBoardMenuOpen, setIsBoardMenuOpen] = useState(false)
  const [boardMessage, setBoardMessage] = useState('')
  const [isBoardStarred, setIsBoardStarred] = useState(() => {
    try { return window.localStorage.getItem('jira_board_starred') === '1' } catch { return false }
  })
  const filteredIssues = useMemo(
    () => projectId ? issues.filter((issue) => issue.projectId === Number(projectId)) : issues,
    [issues, projectId],
  )
  const grouped = useMemo(
    () => STATUS_COLUMNS.reduce((acc, status) => { acc[status] = filteredIssues.filter((issue) => issue.status === status); return acc }, {}),
    [filteredIssues],
  )
  useEffect(() => {
    try { window.localStorage.setItem('jira_board_starred', isBoardStarred ? '1' : '0') } catch { /* ignore */ }
  }, [isBoardStarred])

  async function handleDrop(nextStatus) {
    if (!dragIssueId) return
    const issue = filteredIssues.find((item) => item.id === dragIssueId)
    if (!issue || issue.status === nextStatus) { setDragIssueId(null); setDropStatus(''); return }
    await handleMove(issue.id, nextStatus, issue.sprintId ?? null)
    setDragIssueId(null); setDropStatus('')
  }

  async function handleDeleteBoard() {
    const boardIssues = filteredIssues.filter((issue) => issue.status !== 'Backlog')
    if (boardIssues.length > 0) await Promise.all(boardIssues.map((issue) => handleMove(issue.id, 'Backlog', null)))
    setBoardMessage('Board cleared. All issues moved to backlog.')
    navigate('/backlog')
  }

  return (
    <section className="page">
      <div className="board-jira-header">
        <h1 className="board-jira-title">{projectId ? `${filteredIssues[0]?.key?.split('-')[0] || 'Project'} Board` : 'Kanban board'}</h1>
        <div className="board-jira-actions">
          <div className="board-menu-wrap" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsBoardMenuOpen(false) }}>
            <button className="board-jira-action-btn board-jira-action-btn-boxed" type="button" aria-label="More actions" onClick={() => setIsBoardMenuOpen((c) => !c)}>...</button>
            {isBoardMenuOpen && (
              <div className="board-menu" role="menu">
                <button className="board-menu-item board-menu-item-star" type="button" onClick={() => { const next = !isBoardStarred; setIsBoardStarred(next); setBoardMessage(next ? 'Added to starred.' : 'Removed from starred.'); setIsBoardMenuOpen(false) }}>
                  {isBoardStarred ? 'Remove from starred' : 'Add to starred'}
                </button>
                <button className="board-menu-item board-menu-item-settings" type="button" onClick={() => { setBoardMessage('Opening board settings...'); setIsBoardMenuOpen(false); navigate('/workflows') }}>Board settings</button>
                <button className="board-menu-item board-menu-item-danger board-menu-item-delete" type="button" onClick={async () => { const ok = window.confirm('Delete board? This will move all board issues to backlog.'); if (ok) { setIsBoardMenuOpen(false); await handleDeleteBoard() } }}>Delete board</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {boardMessage && <p className="backlog-message">{boardMessage}</p>}
      <div className="kanban-grid">
        {STATUS_COLUMNS.map((status) => (
          <article key={status} className={`kanban-col${dropStatus === status ? ' kanban-col-drop-active' : ''}`} onDragOver={(event) => { event.preventDefault(); if (dropStatus !== status) setDropStatus(status) }} onDrop={() => handleDrop(status)}>
            <header><h3>{status}</h3><span>{grouped[status]?.length || 0}</span></header>
            {grouped[status]?.map((issue) => (
              <div className="card kanban-card-draggable" key={issue.id} draggable onDragStart={() => setDragIssueId(issue.id)} onDragEnd={() => { setDragIssueId(null); setDropStatus('') }}>
                <button className="issue-link" type="button" onClick={() => navigate(`/issues/${issue.id}`)}>{issue.key}</button>
                <h4>{issue.title}</h4>
                <p>{issue.issueType}</p>
                <select value={issue.status} onChange={(event) => handleMove(issue.id, event.target.value, issue.sprintId ?? null)}>
                  {ISSUE_STATUSES.map((item) => (<option key={item} value={item}>{item}</option>))}
                </select>
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  )
}
