import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useIssues } from '../../context/IssueContext'
import { useMembers } from '../../context/MemberContext'
import { useSprints } from '../../context/SprintContext'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../hooks/usePermissions'
import { fetchIssueById, fetchComments, createComment } from '../../api/issueApi'
import { fetchProjectById } from '../../api/projectApi'
import './IssueDetailPage.css'
import { ISSUE_STATUSES, PRIORITIES, ISSUE_TYPES } from '../../constants'

const TYPE_ICON = {
  Story: { icon: '\u{1F4D7}', color: '#36b37e' },
  Bug:   { icon: '\u{1F41B}', color: '#ff5630' },
  Task:  { icon: '\u2705',     color: '#0065ff' },
}

const PRIORITY_ICON = {
  High:   { icon: '\u2191', color: '#ff5630', bg: '#ffebe6' },
  Medium: { icon: '\u2194', color: '#ff991f', bg: '#fff7e6' },
  Low:    { icon: '\u2193', color: '#36b37e', bg: '#e3fcef' },
}

/* ---- Inline editable field (JIRA click-to-edit pattern) ---- */
function InlineField({ editing, onOpen, onClose, display, children, readOnly }) {
  if (readOnly) return <div className="id-inline-display">{display}</div>
  if (editing) {
    return (
      <div className="id-inline-editor">
        {children}
        <div className="id-inline-actions">
          <button className="id-inline-save" type="button" onClick={onClose} title="Confirm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button className="id-inline-cancel" type="button" onClick={onClose} title="Cancel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="id-inline-display" onClick={onOpen} title="Click to edit">
      {display}
    </div>
  )
}

export function IssueDetailPage() {
  const { issues, handleMove, handleUpdate } = useIssues()
  const { members, profile } = useMembers()
  const { sprints } = useSprints()
  const { authUser } = useAuth()
  const { issueId } = useParams()
  const navigate = useNavigate()
  const id = Number(issueId)
  const issue0 = issues.find((item) => item.id === id)
  const { canEditIssue, canAddComment } = usePermissions(issue0?.projectId)
  const existing = issues.find((item) => item.id === id)
  const [fetchedIssue, setFetchedIssue] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [commentText, setCommentText] = useState('')
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [activityTab, setActivityTab] = useState('All')
  const [isEditing, setIsEditing] = useState(false)
  const [editDesc, setEditDesc] = useState('')
  const [workLogs, setWorkLogs] = useState([])
  const [workLogTime, setWorkLogTime] = useState('')
  const [workLogDesc, setWorkLogDesc] = useState('')
  const [showWorkLogForm, setShowWorkLogForm] = useState(false)
  const [activityOpen, setActivityOpen] = useState(true)

  // Inline edit state — which field is open
  const [editingField, setEditingField] = useState(null)
  // Local label state (no backend support)
  const [labels, setLabels] = useState(['AfterFeb10th', 'Compliance'])
  const [labelInput, setLabelInput] = useState('')
  // Due date local state
  const [dueDate, setDueDate] = useState('')
  // Change history log (tracked from sidebar edits)
  const [changeHistory, setChangeHistory] = useState([])

  // Logged-in user display name
  const currentUserName = profile?.full_name || authUser?.email || 'You'
  const currentUserInitials = currentUserName.slice(0, 2).toUpperCase()

  useEffect(() => {
    if (existing || !id) return
    fetchIssueById(id).then(setFetchedIssue).catch(() => setFetchedIssue(null))
  }, [id, existing])

  const issue = existing || fetchedIssue

  useEffect(() => {
    if (!issue?.projectId) { setProjectName(''); return }
    fetchProjectById(issue.projectId)
      .then((data) => setProjectName(data?.name || ''))
      .catch(() => setProjectName(''))
  }, [issue?.projectId])

  // Fetch comments for this issue
  useEffect(() => {
    if (!issue?.id) return
    setCommentsLoading(true)
    fetchComments(issue.id)
      .then((data) => setComments(Array.isArray(data) ? data : []))
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false))
  }, [issue?.id])

  if (!issue) return <section className="page">Issue not found.</section>

  const typeMeta = TYPE_ICON[issue.issueType] || TYPE_ICON.Task
  const priorityMeta = PRIORITY_ICON[issue.priority] || PRIORITY_ICON.Medium
  const sprint = sprints.find((s) => s.id === issue.sprintId)

  // Build activity entries by type
  const commentEntries = comments.map((c) => ({
    id: c.id,
    type: 'comment',
    author: c.author,
    text: c.text,
    time: c.created_at ? new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now',
    sortKey: c.created_at ? new Date(c.created_at).getTime() : 0,
  }))

  const historyEntries = [...changeHistory]

  const workLogEntries = workLogs.map((w) => ({ ...w, type: 'worklog' }))

  // Filter by active tab
  const allEntries = [...commentEntries, ...historyEntries, ...workLogEntries]
    .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0))
  const visibleEntries =
    activityTab === 'All' ? allEntries
    : activityTab === 'Comments' ? commentEntries
    : activityTab === 'History' ? historyEntries
    : activityTab === 'Work log' ? workLogEntries
    : allEntries

  async function handleAddComment() {
    if (!commentText.trim()) return
    try {
      const saved = await createComment(issue.id, { author: currentUserName, text: commentText.trim() })
      setComments((current) => [saved, ...current])
      setCommentText('')
    } catch {
      // keep text so user can retry
    }
  }

  function addHistoryEntry(field, from, to) {
    setChangeHistory((prev) => [{
      id: `ch-${Date.now()}`,
      type: 'history',
      author: currentUserName,
      text: `changed ${field} from "${from}" to "${to}"`,
      time: 'Just now',
      sortKey: Date.now(),
    }, ...prev])
  }

  function handleAddWorkLog() {
    if (!workLogTime.trim()) return
    setWorkLogs((prev) => [{
      id: `wl-${Date.now()}`,
      author: currentUserName,
      time: 'Just now',
      logged: workLogTime.trim(),
      description: workLogDesc.trim(),
      sortKey: Date.now(),
    }, ...prev])
    setWorkLogTime('')
    setWorkLogDesc('')
    setShowWorkLogForm(false)
  }

  function startEditDesc() {
    setEditDesc(issue.description || '')
    setIsEditing(true)
  }

  function openField(field) {
    setEditingField(field)
  }

  function closeField() {
    setEditingField(null)
  }

  async function onChangeAssignee(e) {
    const prev = issue.assignee || 'Unassigned'
    const next = e.target.value || 'Unassigned'
    await handleUpdate(issue.id, { assignee: e.target.value })
    if (prev !== next) addHistoryEntry('Assignee', prev, next)
    closeField()
  }

  async function onChangePriority(e) {
    const prev = issue.priority
    const next = e.target.value
    await handleUpdate(issue.id, { priority: next })
    if (prev !== next) addHistoryEntry('Priority', prev, next)
    closeField()
  }

  async function onChangeType(e) {
    const prev = issue.issueType
    const next = e.target.value
    await handleUpdate(issue.id, { issueType: next })
    if (prev !== next) addHistoryEntry('Type', prev, next)
    closeField()
  }

  async function onChangeSprint(e) {
    const val = e.target.value
    const prevName = sprint ? sprint.name : 'None'
    await handleUpdate(issue.id, { sprintId: val === '' ? null : Number(val) })
    const nextSprint = sprints.find((s) => s.id === Number(val))
    const nextName = nextSprint ? nextSprint.name : 'None'
    if (prevName !== nextName) addHistoryEntry('Sprint', prevName, nextName)
    closeField()
  }

  function addLabel() {
    const trimmed = labelInput.trim()
    if (trimmed && !labels.includes(trimmed)) {
      setLabels((prev) => [...prev, trimmed])
    }
    setLabelInput('')
  }

  function removeLabel(label) {
    setLabels((prev) => prev.filter((l) => l !== label))
  }

  return (
    <section className="page issue-detail-page">
      {/* ---- Breadcrumb bar ---- */}
      <div className="id-breadcrumb-bar">
        <nav className="id-breadcrumbs">
          <button type="button" className="id-breadcrumb-link" onClick={() => navigate('/projects')}>Projects</button>
          <span className="id-breadcrumb-sep">/</span>
          <button type="button" className="id-breadcrumb-link" onClick={() => navigate(issue.projectId ? `/projects/${issue.projectId}` : '/projects')}>{projectName || 'Project'}</button>
          <span className="id-breadcrumb-sep">/</span>
          <span className="id-breadcrumb-current">{issue.key || `IT-${issue.id}`}</span>
        </nav>
        <div className="id-top-actions" />
      </div>

      {/* ---- Main grid ---- */}
      <div className="id-layout">
        {/* ======== LEFT ======== */}
        <div className="id-main">
          <div className="id-type-row">
            <span className="id-type-icon" style={{ color: typeMeta.color }}>{typeMeta.icon}</span>
            <span className="id-issue-key">{issue.key || `IT-${issue.id}`}</span>
          </div>

          <h1 className="id-title">{issue.title}</h1>

          {canEditIssue && (
            <div className="id-quick-actions">
              <button className="id-quick-btn" type="button">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Attach
              </button>
              <button className="id-quick-btn" type="button">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                Create subtask
              </button>
              <button className="id-quick-btn" type="button">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                Link issue
              </button>
            </div>
          )}

          {/* Description */}
          <div className="id-section">
            <h3 className="id-section-title">Description</h3>
            {isEditing && canEditIssue ? (
              <div className="id-desc-edit">
                <textarea className="id-desc-textarea" rows={5} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                <div className="id-desc-edit-actions">
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => setIsEditing(false)}>Save</button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => setIsEditing(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="id-description" onClick={canEditIssue ? startEditDesc : undefined} title={canEditIssue ? 'Click to edit' : undefined}>
                {issue.description ? <p>{issue.description}</p> : <p className="id-placeholder">{canEditIssue ? 'Add a description...' : 'No description.'}</p>}
              </div>
            )}
          </div>

          <div className="id-section">
            <h3 className="id-section-title">Child issues</h3>
            <p className="id-empty-text">No child issues.</p>
          </div>

          <div className="id-section">
            <h3 className="id-section-title">Linked issues</h3>
            <p className="id-empty-text">No linked issues.</p>
          </div>

          {/* Activity */}
          <div className="id-section">
            <button type="button" className="id-section-title id-section-title--collapsible" onClick={() => setActivityOpen((v) => !v)}>
              Activity
              <svg className={`id-collapse-chevron${activityOpen ? '' : ' id-collapse-chevron--closed'}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {activityOpen && <>
            <div className="id-activity-tabs">
              {['All', 'Comments', 'History', 'Work log'].map((tab) => (
                <button key={tab} type="button" className={`id-activity-tab${activityTab === tab ? ' active' : ''}`} onClick={() => setActivityTab(tab)}>
                  {tab}
                  {tab === 'Comments' && commentEntries.length > 0 && <span className="id-tab-count">{commentEntries.length}</span>}
                  {tab === 'History' && historyEntries.length > 0 && <span className="id-tab-count">{historyEntries.length}</span>}
                  {tab === 'Work log' && workLogEntries.length > 0 && <span className="id-tab-count">{workLogEntries.length}</span>}
                </button>
              ))}
            </div>

            {/* Comment input — show on All or Comments tab */}
            {canAddComment && (activityTab === 'All' || activityTab === 'Comments') && (
              <div className="id-comment-input">
                <span className="id-comment-avatar id-comment-avatar--me">{currentUserInitials}</span>
                <div className="id-comment-box">
                  <span className="id-comment-user-name">{currentUserName}</span>
                  <textarea rows={2} value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Add a comment..." className="id-comment-textarea" />
                  {commentText.trim() && (
                    <div className="id-comment-actions">
                      <button className="btn btn-primary btn-sm" type="button" onClick={handleAddComment}>Save</button>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setCommentText('')}>Cancel</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Work log input — show on Work log tab */}
            {canEditIssue && activityTab === 'Work log' && (
              <div className="id-worklog-area">
                {!showWorkLogForm ? (
                  <button className="id-worklog-add-btn" type="button" onClick={() => setShowWorkLogForm(true)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Log work
                  </button>
                ) : (
                  <div className="id-worklog-form">
                    <div className="id-worklog-form-row">
                      <label>Time spent</label>
                      <input className="id-inline-input" value={workLogTime} onChange={(e) => setWorkLogTime(e.target.value)} placeholder="e.g. 2h 30m" autoFocus />
                    </div>
                    <div className="id-worklog-form-row">
                      <label>Description</label>
                      <input className="id-inline-input" value={workLogDesc} onChange={(e) => setWorkLogDesc(e.target.value)} placeholder="What did you work on?" />
                    </div>
                    <div className="id-worklog-form-actions">
                      <button className="btn btn-primary btn-sm" type="button" onClick={handleAddWorkLog}>Log</button>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setShowWorkLogForm(false); setWorkLogTime(''); setWorkLogDesc('') }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Activity feed */}
            <div className="id-activity-feed">
              {visibleEntries.length === 0 && (
                <p className="id-empty-text">
                  {activityTab === 'Comments' ? 'No comments yet.' : activityTab === 'History' ? 'No changes recorded.' : activityTab === 'Work log' ? 'No work logged.' : 'No activity yet.'}
                </p>
              )}
              {visibleEntries.map((entry) => (
                <div key={entry.id} className={`id-activity-item id-activity-item--${entry.type}`}>
                  <span className={`id-comment-avatar${entry.author === currentUserName ? ' id-comment-avatar--me' : ''}`}>
                    {entry.author.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="id-activity-item-body">
                    <div className="id-comment-meta">
                      <strong>{entry.author}</strong>
                      {entry.type === 'history' && <span className="id-history-badge">History</span>}
                      {entry.type === 'worklog' && <span className="id-worklog-badge">Work log</span>}
                      <span className="id-comment-time">{entry.time}</span>
                    </div>
                    {entry.type === 'comment' && (
                      <p className="id-comment-text">{entry.text}</p>
                    )}
                    {entry.type === 'history' && (
                      <p className="id-history-text">{entry.text}</p>
                    )}
                    {entry.type === 'worklog' && (
                      <div className="id-worklog-detail">
                        <span className="id-worklog-time-badge">{entry.logged}</span>
                        {entry.description && <span className="id-worklog-desc">{entry.description}</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            </>}
          </div>
        </div>

        {/* ======== RIGHT SIDEBAR (editable fields) ======== */}
        <aside className="id-sidebar">
          {/* Status */}
          <div className="id-sidebar-status">
            <select
              className="id-status-select"
              value={issue.status}
              onChange={(e) => handleMove(issue.id, e.target.value)}
              disabled={!canEditIssue}
              style={{
                background: issue.status === 'Done' ? '#e3fcef' : issue.status === 'In Progress' ? '#deebff' : issue.status === 'Code Review' ? '#eae6ff' : '#dfe1e6',
                color: issue.status === 'Done' ? '#006644' : issue.status === 'In Progress' ? '#0052cc' : issue.status === 'Code Review' ? '#5243aa' : '#42526e',
              }}
            >
              {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Details */}
          <div className="id-sidebar-section">
            <div className="id-sidebar-section-header"><h4>Details</h4></div>
            <dl className="id-detail-list">
              {/* Assignee — editable */}
              <div className="id-detail-row">
                <dt>Assignee</dt>
                <dd>
                  <InlineField
                    readOnly={!canEditIssue}
                    editing={editingField === 'assignee'}
                    onOpen={() => openField('assignee')}
                    onClose={closeField}
                    display={
                      <div className="id-detail-user">
                        <span className="id-detail-avatar">{(issue.assignee || 'U').slice(0, 2).toUpperCase()}</span>
                        <span>{issue.assignee || 'Unassigned'}</span>
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </div>
                    }
                  >
                    <select className="id-inline-select" value={issue.assignee || ''} onChange={onChangeAssignee} autoFocus>
                      <option value="">Unassigned</option>
                      {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                    </select>
                  </InlineField>
                </dd>
              </div>

              {/* Reporter — read-only */}
              <div className="id-detail-row">
                <dt>Reporter</dt>
                <dd>
                  <div className="id-detail-user">
                    <span className="id-detail-avatar" style={{ background: '#0052cc', color: '#fff' }}>
                      {(profile?.full_name || 'U').slice(0, 2).toUpperCase()}
                    </span>
                    <span>{profile?.full_name || 'Unknown'}</span>
                  </div>
                </dd>
              </div>

              {/* Priority — editable */}
              <div className="id-detail-row">
                <dt>Priority</dt>
                <dd>
                  <InlineField
                    readOnly={!canEditIssue}
                    editing={editingField === 'priority'}
                    onOpen={() => openField('priority')}
                    onClose={closeField}
                    display={
                      <span className="id-priority-badge" style={{ background: priorityMeta.bg, color: priorityMeta.color }}>
                        <span className="id-priority-arrow">{priorityMeta.icon}</span>
                        {issue.priority}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <select className="id-inline-select" value={issue.priority} onChange={onChangePriority} autoFocus>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </InlineField>
                </dd>
              </div>

              {/* Type — editable */}
              <div className="id-detail-row">
                <dt>Type</dt>
                <dd>
                  <InlineField
                    readOnly={!canEditIssue}
                    editing={editingField === 'type'}
                    onOpen={() => openField('type')}
                    onClose={closeField}
                    display={
                      <span className="id-type-badge">
                        <span style={{ color: typeMeta.color }}>{typeMeta.icon}</span>
                        {issue.issueType}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <select className="id-inline-select" value={issue.issueType} onChange={onChangeType} autoFocus>
                      {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </InlineField>
                </dd>
              </div>

              {/* Labels — editable (local only) */}
              <div className="id-detail-row">
                <dt>Labels</dt>
                <dd>
                  <InlineField
                    readOnly={!canEditIssue}
                    editing={editingField === 'labels'}
                    onOpen={() => openField('labels')}
                    onClose={closeField}
                    display={
                      <div className="id-labels-wrap">
                        {labels.length > 0 ? labels.map((l) => <span key={l} className="pill">{l}</span>) : <span className="id-empty-value">None</span>}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </div>
                    }
                  >
                    <div className="id-labels-editor">
                      <div className="id-labels-list">
                        {labels.map((l) => (
                          <span key={l} className="id-label-chip">
                            {l}
                            <button type="button" className="id-label-remove" onClick={() => removeLabel(l)}>&times;</button>
                          </span>
                        ))}
                      </div>
                      <div className="id-label-add-row">
                        <input
                          className="id-inline-input"
                          value={labelInput}
                          onChange={(e) => setLabelInput(e.target.value)}
                          placeholder="Add label..."
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLabel() } }}
                        />
                        <button className="id-label-add-btn" type="button" onClick={addLabel}>Add</button>
                      </div>
                    </div>
                  </InlineField>
                </dd>
              </div>

              {/* Sprint — editable */}
              <div className="id-detail-row">
                <dt>Sprint</dt>
                <dd>
                  <InlineField
                    readOnly={!canEditIssue}
                    editing={editingField === 'sprint'}
                    onOpen={() => openField('sprint')}
                    onClose={closeField}
                    display={
                      <span className="id-sprint-display">
                        {sprint ? sprint.name : <span className="id-empty-value">None</span>}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <select className="id-inline-select" value={issue.sprintId || ''} onChange={onChangeSprint} autoFocus>
                      <option value="">None</option>
                      {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </InlineField>
                </dd>
              </div>
            </dl>
          </div>

          {/* Dates */}
          <div className="id-sidebar-section">
            <div className="id-sidebar-section-header"><h4>Dates</h4></div>
            <dl className="id-detail-list">
              <div className="id-detail-row">
                <dt>Created</dt>
                <dd>{issue.createdAt ? new Date(issue.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'}</dd>
              </div>
              <div className="id-detail-row">
                <dt>Due date</dt>
                <dd>
                  <InlineField
                    readOnly={!canEditIssue}
                    editing={editingField === 'dueDate'}
                    onOpen={() => openField('dueDate')}
                    onClose={closeField}
                    display={
                      <span className="id-sprint-display">
                        {dueDate ? new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : <span className="id-empty-value">None</span>}
                        <span className="id-edit-pencil">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </span>
                      </span>
                    }
                  >
                    <input
                      className="id-inline-input"
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      autoFocus
                    />
                  </InlineField>
                </dd>
              </div>
            </dl>
          </div>

        </aside>
      </div>
    </section>
  )
}
