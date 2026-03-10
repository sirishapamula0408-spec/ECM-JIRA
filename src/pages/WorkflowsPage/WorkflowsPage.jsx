import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useIssues } from '../../context/IssueContext'
import { useSprints } from '../../context/SprintContext'
import { useAuth } from '../../context/AuthContext'
import './WorkflowsPage.css'
import { useMembers } from '../../context/MemberContext'
import { usePermissions } from '../../hooks/usePermissions'
import { ISSUE_STATUSES } from '../../constants'

/* ── Column definitions ── */
const ALL_COLUMNS = {
  type:     { label: 'Type',     thClass: 'col-type',     tdClass: '' },
  key:      { label: 'Key',      thClass: 'col-key',      tdClass: 'jira-list-key' },
  summary:  { label: 'Summary',  thClass: 'col-summary',  tdClass: '' },
  status:   { label: 'Status',   thClass: 'col-status',   tdClass: '' },
  comments: { label: 'Comments', thClass: 'col-comments', tdClass: '' },
  sprint:   { label: 'Sprint',   thClass: 'col-sprint',   tdClass: 'jira-list-sprint' },
  priority: { label: 'Priority', thClass: 'col-extra',    tdClass: 'jira-list-extra-cell', width: 100 },
  assignee: { label: 'Assignee', thClass: 'col-extra',    tdClass: 'jira-list-extra-cell', width: 140 },
  created:  { label: 'Created',  thClass: 'col-extra',    tdClass: 'jira-list-extra-cell', width: 110 },
  label:    { label: 'Label',    thClass: 'col-extra',    tdClass: 'jira-list-extra-cell', width: 100 },
  dueDate:  { label: 'Due Date', thClass: 'col-extra',    tdClass: 'jira-list-extra-cell', width: 110 },
}

const DEFAULT_COL_KEYS = ['type', 'key', 'summary', 'status', 'comments', 'sprint']
const EXTRA_COL_KEYS = ['priority', 'assignee', 'created', 'label', 'dueDate']

const DEFAULT_WIDTHS = {
  type: 90, key: 110, summary: 300, status: 130,
  comments: 150, sprint: 120, priority: 100,
  assignee: 150, created: 120, label: 100, dueDate: 120,
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function WorkflowsPage() {
  const { issues, handleCreate: onCreateIssue, handleMove } = useIssues()
  const { sprints } = useSprints()
  const { authUser: currentUser } = useAuth()
  const { profile } = useMembers()
  const { projectId } = useParams()
  const { canCreateIssue, canEditIssue } = usePermissions(projectId)
  const scopedIssues = projectId ? issues.filter((issue) => issue.projectId === Number(projectId)) : issues
  const defaultAssignee = profile?.full_name || 'Alex Rivera'
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [groupBy, setGroupBy] = useState('none')
  const [selectedIds, setSelectedIds] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const [columnOrder, setColumnOrder] = useState(DEFAULT_COL_KEYS)
  const [showColumnMenu, setShowColumnMenu] = useState(false)
  const [dragColKey, setDragColKey] = useState(null)
  const [dragOverColKey, setDragOverColKey] = useState(null)
  const [columnWidths, setColumnWidths] = useState(DEFAULT_WIDTHS)
  const resizeRef = useRef(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState('')
  const PAGE_SIZE = 25

  const sprintById = useMemo(() => {
    const map = new Map()
    ;(Array.isArray(sprints) ? sprints : []).forEach((sprint) => map.set(sprint.id, sprint.name))
    return map
  }, [sprints])

  const filteredRows = useMemo(() => {
    const list = Array.isArray(scopedIssues) ? scopedIssues : []
    const normalized = query.trim().toLowerCase()
    return list.filter((issue) => {
      const matchesQuery = !normalized || String(issue.key || '').toLowerCase().includes(normalized) || String(issue.title || '').toLowerCase().includes(normalized)
      const matchesStatus = statusFilter === 'All' || issue.status === statusFilter
      return matchesQuery && matchesStatus
    })
  }, [scopedIssues, query, statusFilter])

  // Reset to page 1 when filters change
  useEffect(() => { setCurrentPage(1) }, [query, statusFilter])

  const totalCount = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)

  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filteredRows.slice(start, start + PAGE_SIZE)
  }, [filteredRows, safePage])

  const groupedRows = useMemo(() => {
    if (groupBy === 'none') return [{ label: '', rows: paginatedRows }]
    const groups = new Map()
    paginatedRows.forEach((issue) => {
      const label = groupBy === 'status' ? String(issue.status || 'Uncategorized') : String(sprintById.get(issue.sprintId) || 'No sprint')
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(issue)
    })
    return Array.from(groups.entries()).map(([label, rows]) => ({ label, rows }))
  }, [paginatedRows, groupBy, sprintById])

  const allVisibleIds = paginatedRows.map((issue) => issue.id)
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.includes(id))

  function toggleSelectAll(checked) { setSelectedIds(checked ? allVisibleIds : []) }
  function toggleSelectOne(id, checked) {
    setSelectedIds((current) => { if (checked) return Array.from(new Set([...current, id])); return current.filter((item) => item !== id) })
  }

  function issueTypeIcon(issueType) {
    if (issueType === 'Story') return <span className="list-type-mark list-type-story" />
    if (issueType === 'Bug') return <span className="list-type-mark list-type-bug" />
    return <span className="list-type-mark list-type-task" />
  }

  function statusChip(status) {
    if (status === 'In Progress') return 'IN PROGRESS'
    if (status === 'Code Review') return 'IN REVIEW'
    if (status === 'Done') return 'DONE'
    if (status === 'Backlog') return 'BACKLOG'
    return 'TO DO'
  }

  /* ── Column toggle (add / remove from "+" menu) ── */
  function toggleColumn(colKey) {
    setColumnOrder((current) => {
      if (current.includes(colKey)) {
        return current.filter((k) => k !== colKey)
      }
      return [...current, colKey]
    })
  }

  /* ── Column drag-and-drop reorder ── */
  function handleColDragStart(e, colKey) {
    setDragColKey(colKey)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', colKey)
  }

  function handleColDragOver(e, colKey) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragColKey && colKey !== dragColKey) {
      setDragOverColKey(colKey)
    }
  }

  function handleColDrop(e, targetColKey) {
    e.preventDefault()
    if (!dragColKey || dragColKey === targetColKey) {
      setDragColKey(null)
      setDragOverColKey(null)
      return
    }
    setColumnOrder((current) => {
      const next = current.filter((k) => k !== dragColKey)
      const targetIdx = next.indexOf(targetColKey)
      next.splice(targetIdx, 0, dragColKey)
      return next
    })
    setDragColKey(null)
    setDragOverColKey(null)
  }

  function handleColDragEnd() {
    setDragColKey(null)
    setDragOverColKey(null)
  }

  /* ── Column resize ── */
  const handleResizeStart = useCallback((e, colKey) => {
    e.stopPropagation()
    e.preventDefault()
    resizeRef.current = {
      colKey,
      startX: e.clientX,
      startWidth: columnWidths[colKey] || DEFAULT_WIDTHS[colKey] || 100,
    }
    document.body.classList.add('col-resizing')
  }, [columnWidths])

  useEffect(() => {
    function onMouseMove(e) {
      if (!resizeRef.current) return
      const { colKey, startX, startWidth } = resizeRef.current
      const newWidth = Math.max(50, startWidth + (e.clientX - startX))
      setColumnWidths((prev) => ({ ...prev, [colKey]: newWidth }))
    }
    function onMouseUp() {
      if (!resizeRef.current) return
      resizeRef.current = null
      document.body.classList.remove('col-resizing')
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  /* ── Cell renderer ── */
  function renderCell(colKey, issue, rowIndex) {
    switch (colKey) {
      case 'type':
        return issueTypeIcon(issue.issueType)
      case 'key':
        return <button className="jira-list-key-link" type="button" onClick={() => navigate(`/issues/${issue.id}`)}>{issue.key}</button>
      case 'summary':
        return <button className="jira-list-summary-link" type="button" onClick={() => navigate(`/issues/${issue.id}`)}>{issue.title}</button>
      case 'status':
        return (
          <select
            className="jira-list-status-select"
            value={issue.status}
            onChange={(e) => handleMove(issue.id, e.target.value, e.target.value === 'Backlog' ? null : issue.sprintId)}
            disabled={!canEditIssue}
          >
            {ISSUE_STATUSES.map((s) => (
              <option key={s} value={s}>{statusChip(s)}</option>
            ))}
          </select>
        )
      case 'comments': {
        const hasComment = rowIndex % 3 === 1
        return (
          <span className="jira-list-comment-cell">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3.5h10v7H6.5L3 13V3.5Z" /><path d="M5.5 6.5h5M5.5 8.5h3.5" /></svg>
            {hasComment ? (<span className="jira-list-comment-count"><i />1 comment</span>) : 'Add comment'}
          </span>
        )
      }
      case 'sprint':
        return (issue.sprintId ? sprintById.get(issue.sprintId) : '') || ''
      case 'priority':
        return issue.priority || '-'
      case 'assignee':
        return issue.assignee || '-'
      case 'created':
        return formatDate(issue.createdAt || issue.created_at)
      case 'label':
        return '-'
      case 'dueDate':
        return '-'
      default:
        return ''
    }
  }

  const totalColSpan = columnOrder.length + 2 // checkbox + "+" column

  async function submitInlineCreate() {
    const title = String(createTitle || '').trim()
    if (!title) { setCreateError('Summary is required.'); return }
    setCreateBusy(true); setCreateError('')
    try {
      await onCreateIssue({ title, description: 'Created from list quick add.', assignee: defaultAssignee, priority: 'Medium', status: 'Backlog', issueType: 'Task', sprintId: null })
      setCreateTitle(''); setIsCreateOpen(false)
    } catch (error) { setCreateError(error?.message || 'Failed to create issue') }
    finally { setCreateBusy(false) }
  }

  const currentUserEmail = String(currentUser?.email || '').trim()
  const emailLocal = currentUserEmail.includes('@') ? currentUserEmail.split('@')[0] : currentUserEmail
  const currentUserName = String(currentUser?.name || '').trim()
  const nameParts = currentUserName.split(/\s+/).filter(Boolean).concat(emailLocal.split(/[._-]+/).filter(Boolean))
  const userInitials = (nameParts[0]?.[0] || '') + (nameParts[1]?.[0] || nameParts[0]?.[1] || '')
  const normalizedInitials = (userInitials || 'U').toUpperCase()
  const userTooltip = currentUserName || currentUserEmail || profile?.full_name || 'User'

  return (
    <section className="page jira-list-page">
      <div className="jira-list-toolbar">
        <div className="jira-list-toolbar-left">
          <label className="jira-list-search">
            <span className="jira-list-search-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
            </span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search list" type="text" />
          </label>
          <div className="jira-list-presence" aria-hidden="true"><span title={userTooltip}>{normalizedInitials}</span></div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="jira-list-select">
            <option value="All">Filter</option>
            <option value="Backlog">Backlog</option>
            <option value="To Do">To Do</option>
            <option value="In Progress">In Progress</option>
            <option value="Code Review">Code Review</option>
            <option value="Done">Done</option>
          </select>
        </div>
        <div className="jira-list-toolbar-right">
          <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)} className="jira-list-select">
            <option value="none">Group</option>
            <option value="status">Group by status</option>
            <option value="sprint">Group by sprint</option>
          </select>
          <button type="button" className="jira-list-icon-btn" aria-label="Display settings">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2.5 4.5h5M2.5 8h8M2.5 11.5h5M10.5 4.5h3M12 3v3M8.5 11.5h5M11 10v3" /></svg>
          </button>
          <button type="button" className="jira-list-icon-btn" aria-label="More options">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><circle cx="3.5" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="12.5" cy="8" r="1" /></svg>
          </button>
        </div>
      </div>

      <article className="jira-list-table-shell">
        <div className="jira-list-table-scroll">
          <table className="jira-list-table">
            <thead>
              <tr>
                <th className="col-check"><input type="checkbox" checked={allSelected} onChange={(event) => toggleSelectAll(event.target.checked)} /></th>
                {columnOrder.map((colKey) => {
                  const def = ALL_COLUMNS[colKey]
                  const isDragging = dragColKey === colKey
                  const isOver = dragOverColKey === colKey && dragColKey !== colKey
                  const w = columnWidths[colKey] || DEFAULT_WIDTHS[colKey]
                  return (
                    <th
                      key={colKey}
                      className={
                        (def.thClass || '') +
                        (isDragging ? ' col-dragging' : '') +
                        (isOver ? ' col-drag-over' : '')
                      }
                      style={{ width: w, minWidth: 50 }}
                      draggable
                      onDragStart={(e) => handleColDragStart(e, colKey)}
                      onDragOver={(e) => handleColDragOver(e, colKey)}
                      onDrop={(e) => handleColDrop(e, colKey)}
                      onDragEnd={handleColDragEnd}
                      onDragLeave={() => { if (dragOverColKey === colKey) setDragOverColKey(null) }}
                    >
                      <span className="col-header-content">
                        <svg className="col-drag-handle" viewBox="0 0 8 14" width="8" height="14" fill="currentColor" aria-hidden="true">
                          <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
                          <circle cx="2" cy="7" r="1" /><circle cx="6" cy="7" r="1" />
                          <circle cx="2" cy="12" r="1" /><circle cx="6" cy="12" r="1" />
                        </svg>
                        {def.label}
                      </span>
                      <div
                        className="col-resize-handle"
                        onMouseDown={(e) => handleResizeStart(e, colKey)}
                        draggable={false}
                        role="separator"
                        aria-orientation="vertical"
                      />
                    </th>
                  )
                })}
                <th className="col-plus">
                  <div className="jira-list-col-menu-wrap" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setShowColumnMenu(false) }}>
                    <button
                      className="jira-list-col-menu-trigger"
                      type="button"
                      aria-label="Add column"
                      onClick={() => setShowColumnMenu((c) => !c)}
                    >+</button>
                    {showColumnMenu && (
                      <div className="jira-list-col-menu" role="menu">
                        {EXTRA_COL_KEYS.map((colKey) => {
                          const def = ALL_COLUMNS[colKey]
                          const active = columnOrder.includes(colKey)
                          return (
                            <button
                              key={colKey}
                              className={`jira-list-col-menu-item${active ? ' active' : ''}`}
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={active}
                              onClick={() => toggleColumn(colKey)}
                            >
                              <span className="jira-list-col-check">{active ? '\u2713' : ''}</span>
                              {def.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map((group) => (
                <Fragment key={group.label || 'all'}>
                  {group.label && (<tr className="jira-list-group-row"><td colSpan={totalColSpan}><strong>{group.label}</strong> <span>{group.rows.length}</span></td></tr>)}
                  {group.rows.map((issue, index) => {
                    const selected = selectedIds.includes(issue.id)
                    return (
                      <tr key={issue.id} className={selected ? 'row-selected' : ''}>
                        <td><input type="checkbox" checked={selected} onChange={(event) => toggleSelectOne(issue.id, event.target.checked)} /></td>
                        {columnOrder.map((colKey) => {
                          const def = ALL_COLUMNS[colKey]
                          const isDragging = dragColKey === colKey
                          return (
                            <td
                              key={colKey}
                              className={
                                (def.tdClass || '') +
                                (isDragging ? ' col-dragging' : '')
                              }
                            >
                              {renderCell(colKey, issue, index)}
                            </td>
                          )
                        })}
                        <td />
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="jira-list-scroll-track"><span /></div>
        {totalCount > PAGE_SIZE && (
          <div className="jira-list-pagination">
            <button
              className="btn btn-ghost jira-list-page-btn"
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="jira-list-page-info">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, totalCount)} of {totalCount}
            </span>
            <button
              className="btn btn-ghost jira-list-page-btn"
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        )}
        {canCreateIssue && (isCreateOpen ? (
          <div className="quick-create-row">
            <input className="quick-create-input" type="text" placeholder="What needs to be done?" value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitInlineCreate(); if (event.key === 'Escape') { setIsCreateOpen(false); setCreateTitle(''); setCreateError('') } }} autoFocus />
            <button className="btn btn-primary quick-create-btn" type="button" onClick={submitInlineCreate} disabled={createBusy}>Create</button>
            <button className="btn btn-ghost quick-create-btn" type="button" onClick={() => { setIsCreateOpen(false); setCreateTitle(''); setCreateError('') }} disabled={createBusy}>Cancel</button>
            {createError && <p className="quick-create-error">{createError}</p>}
          </div>
        ) : (
          <button className="jira-list-create" type="button" onClick={() => { setIsCreateOpen(true); setCreateError('') }}>
            <span className="plus-create-content"><span className="plus-create-symbol">+</span><span>Create</span></span>
          </button>
        ))}
      </article>
    </section>
  )
}
