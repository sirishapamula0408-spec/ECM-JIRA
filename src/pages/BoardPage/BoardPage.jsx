import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useIssues } from '../../context/IssueContext'
import { usePermissions } from '../../hooks/usePermissions'
import { fetchBoardConfig, saveBoardConfig, ESTIMATION_STATISTIC_OPTIONS } from '../../api/boardConfigApi'
import { ISSUE_STATUSES, STATUS_COLUMNS } from '../../constants'
import { DueDateBadge } from '../../components/issues/DueDateBadge'
import { ImpedimentFlagIndicator } from '../../components/issues/ImpedimentFlag'
import './BoardPage.css'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useConfirm } from '../../components/common/ConfirmDialog'

const SWIMLANE_OPTIONS = [
  { value: 'none', label: 'No swimlanes' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'epic', label: 'Epic' },
  { value: 'priority', label: 'Priority' },
]

// Resolve the grouping value for an issue given a swimlane mode.
function swimlaneValueFor(issue, mode) {
  if (mode === 'assignee') return issue.assignee || 'Unassigned'
  if (mode === 'priority') return issue.priority || 'None'
  if (mode === 'epic') return issue.epic || issue.epicName || 'No epic'
  return 'all'
}

export function BoardPage() {
  usePageTitle('Board')
  const { confirm, confirmDialog } = useConfirm()
  const { issues, handleMove } = useIssues()
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { canManageProjectSettings, canEditIssue } = usePermissions(projectId)

  const [dragIssueId, setDragIssueId] = useState(null)
  const [dropColId, setDropColId] = useState('')
  const [isBoardMenuOpen, setIsBoardMenuOpen] = useState(false)
  const [boardMessage, setBoardMessage] = useState('')

  // JL-85 board configuration state
  const [swimlaneBy, setSwimlaneBy] = useState('none')
  const [wipLimits, setWipLimits] = useState({})
  // JL-126: configurable estimation statistic (story points / time / count)
  const [estimationStatistic, setEstimationStatistic] = useState('story_points')
  // JL-308: Atlassian-style column configuration ([{ id, name, statuses[] }]).
  // Empty = fall back to the default one-column-per-workflow-status board.
  const [columns, setColumns] = useState([])
  const [activeFilters, setActiveFilters] = useState([]) // e.g. ['assignee:Alice', 'type:Bug']
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const [isBoardStarred, setIsBoardStarred] = useState(() => {
    try { return window.localStorage.getItem('jira_board_starred') === '1' } catch { return false }
  })

  const filteredIssues = useMemo(
    () => projectId ? issues.filter((issue) => issue.projectId === Number(projectId)) : issues,
    [issues, projectId],
  )

  // Load persisted board config for this project.
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    fetchBoardConfig(projectId)
      .then((cfg) => {
        if (cancelled || !cfg) return
        setSwimlaneBy(cfg.swimlaneBy || 'none')
        setWipLimits(cfg.wipLimits || {})
        setEstimationStatistic(cfg.estimationStatistic || 'story_points')
        setColumns(Array.isArray(cfg.columns) ? cfg.columns : [])
      })
      .catch(() => { /* fall back to defaults */ })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    try { window.localStorage.setItem('jira_board_starred', isBoardStarred ? '1' : '0') } catch { /* ignore */ }
  }, [isBoardStarred])

  // Available quick-filter chips derived from the current issues.
  const quickFilterChips = useMemo(() => {
    const assignees = new Set()
    const types = new Set()
    for (const issue of filteredIssues) {
      assignees.add(issue.assignee || 'Unassigned')
      if (issue.issueType) types.add(issue.issueType)
    }
    return [
      ...[...assignees].sort().map((v) => ({ cat: 'assignee', value: v, key: `assignee:${v}` })),
      ...[...types].sort().map((v) => ({ cat: 'type', value: v, key: `type:${v}` })),
    ]
  }, [filteredIssues])

  // Apply active quick filters (AND across categories, OR within a category).
  const visibleIssues = useMemo(() => {
    if (activeFilters.length === 0) return filteredIssues
    const byCat = {}
    for (const key of activeFilters) {
      const [cat, ...rest] = key.split(':')
      ;(byCat[cat] ||= []).push(rest.join(':'))
    }
    return filteredIssues.filter((issue) => {
      for (const [cat, values] of Object.entries(byCat)) {
        const iv = cat === 'assignee' ? (issue.assignee || 'Unassigned') : issue.issueType
        if (!values.includes(iv)) return false
      }
      return true
    })
  }, [filteredIssues, activeFilters])

  // JL-126: board estimation total by the configured statistic.
  const estimationTotal = useMemo(() => {
    if (estimationStatistic === 'issue_count') return visibleIssues.length
    const field = estimationStatistic === 'time_estimate' ? 'originalEstimateMinutes' : 'storyPoints'
    return visibleIssues.reduce((sum, issue) => {
      const n = Number(issue[field])
      return Number.isFinite(n) ? sum + n : sum
    }, 0)
  }, [visibleIssues, estimationStatistic])

  const estimationLabel = useMemo(
    () => ESTIMATION_STATISTIC_OPTIONS.find((o) => o.value === estimationStatistic)?.label || 'Story Points',
    [estimationStatistic],
  )
  const estimationTotalDisplay = estimationStatistic === 'time_estimate'
    ? `${Math.round((estimationTotal / 60) * 10) / 10}h`
    : estimationTotal

  // Build swimlanes: one labelled row per group (or a single unlabeled lane).
  const swimlanes = useMemo(() => {
    if (swimlaneBy === 'none') {
      return [{ key: 'all', label: null, issues: visibleIssues }]
    }
    const map = new Map()
    for (const issue of visibleIssues) {
      const value = swimlaneValueFor(issue, swimlaneBy)
      if (!map.has(value)) map.set(value, [])
      map.get(value).push(issue)
    }
    return [...map.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([value, laneIssues]) => ({ key: value, label: value, issues: laneIssues }))
  }, [visibleIssues, swimlaneBy])

  // JL-308: the columns actually rendered on the board. When no column config
  // is saved, fall back to the historical default: one column per non-backlog
  // workflow status.
  const boardColumns = useMemo(() => {
    if (Array.isArray(columns) && columns.length > 0) {
      return columns.map((col) => ({ id: col.id, name: col.name, statuses: col.statuses || [] }))
    }
    return STATUS_COLUMNS.map((status) => ({ id: status, name: status, statuses: [status] }))
  }, [columns])

  // Materialised columns for the settings editor — defaults are shown so an
  // admin can start from the current board rather than a blank slate.
  const editorColumns = useMemo(() => (
    Array.isArray(columns) && columns.length > 0
      ? columns
      : STATUS_COLUMNS.map((status) => ({ id: status, name: status, statuses: [status] }))
  ), [columns])

  // Workflow statuses not mapped to any column (Jira's backlog/unmapped area).
  const unmappedStatuses = useMemo(() => {
    const mapped = new Set(editorColumns.flatMap((col) => col.statuses || []))
    return ISSUE_STATUSES.filter((status) => !mapped.has(status))
  }, [editorColumns])

  function addColumn() {
    setColumns([...editorColumns, { id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: 'New column', statuses: [] }])
  }
  function renameColumn(id, name) {
    setColumns(editorColumns.map((col) => (col.id === id ? { ...col, name } : col)))
  }
  function removeColumn(id) {
    setColumns(editorColumns.filter((col) => col.id !== id))
  }
  function moveColumn(id, direction) {
    const next = [...editorColumns]
    const index = next.findIndex((col) => col.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setColumns(next)
  }
  function assignStatus(colId, status) {
    if (!status) return
    setColumns(editorColumns.map((col) => ({
      ...col,
      statuses: col.id === colId
        ? [...(col.statuses || []).filter((s) => s !== status), status]
        : (col.statuses || []).filter((s) => s !== status),
    })))
  }
  function unassignStatus(colId, status) {
    setColumns(editorColumns.map((col) => (
      col.id === colId ? { ...col, statuses: (col.statuses || []).filter((s) => s !== status) } : col
    )))
  }

  function toggleFilter(key) {
    setActiveFilters((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    )
  }

  async function handleDrop(col) {
    if (!canEditIssue) return
    if (!dragIssueId) return
    const targetStatus = (col.statuses || [])[0]
    const issue = filteredIssues.find((item) => item.id === dragIssueId)
    // Ignore drops onto unmapped columns or when the card already sits in this column.
    if (!targetStatus || !issue || (col.statuses || []).includes(issue.status)) {
      setDragIssueId(null); setDropColId(''); return
    }
    await handleMove(issue.id, targetStatus, issue.sprintId ?? null)
    setDragIssueId(null); setDropColId('')
  }

  async function handleDeleteBoard() {
    const boardIssues = filteredIssues.filter((issue) => issue.status !== 'Backlog')
    if (boardIssues.length > 0) await Promise.all(boardIssues.map((issue) => handleMove(issue.id, 'Backlog', null)))
    setBoardMessage('Board cleared. All issues moved to backlog.')
    navigate('/backlog')
  }

  async function handleSaveConfig() {
    if (!projectId) { setIsSettingsOpen(false); return }
    // Keep only positive integer limits.
    const cleanLimits = {}
    for (const [status, limit] of Object.entries(wipLimits)) {
      const n = Number(limit)
      if (Number.isInteger(n) && n > 0) cleanLimits[status] = n
    }
    try {
      await saveBoardConfig(projectId, { swimlaneBy, wipLimits: cleanLimits, quickFilters: [], estimationStatistic, columns })
      setWipLimits(cleanLimits)
      setBoardMessage('Board settings saved.')
      setIsSettingsOpen(false)
    } catch {
      setBoardMessage('Could not save board settings.')
    }
  }

  return (
    <section className="page">
      <div className="board-jira-header">
        <h1 className="board-jira-title">{projectId ? `${filteredIssues[0]?.key?.split('-')[0] || 'Project'} Board` : 'Kanban board'}</h1>
        <div className="board-jira-actions">
          <button className="board-jira-action-btn board-jira-action-btn-boxed board-settings-toggle" type="button" onClick={() => setIsSettingsOpen((c) => !c)}>Board settings</button>
          <div className="board-menu-wrap" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsBoardMenuOpen(false) }}>
            <button className="board-jira-action-btn board-jira-action-btn-boxed" type="button" aria-label="More actions" onClick={() => setIsBoardMenuOpen((c) => !c)}>...</button>
            {isBoardMenuOpen && (
              <div className="board-menu" role="menu">
                <button className="board-menu-item board-menu-item-star" type="button" onClick={() => { const next = !isBoardStarred; setIsBoardStarred(next); setBoardMessage(next ? 'Added to starred.' : 'Removed from starred.'); setIsBoardMenuOpen(false) }}>
                  {isBoardStarred ? 'Remove from starred' : 'Add to starred'}
                </button>
                <button className="board-menu-item board-menu-item-settings" type="button" onClick={() => { setIsBoardMenuOpen(false); setIsSettingsOpen(true) }}>Board settings</button>
                {canManageProjectSettings && (
                  <button className="board-menu-item board-menu-item-danger board-menu-item-delete" type="button" onClick={async () => { const ok = await confirm({ title: 'Delete board?', message: 'Delete board? This will move all board issues to backlog.', confirmLabel: 'Delete board', danger: true }); if (ok) { setIsBoardMenuOpen(false); await handleDeleteBoard() } }}>Delete board</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {boardMessage && <p className="backlog-message">{boardMessage}</p>}

      {/* Quick filters */}
      <div className="board-controls">
        <div className="board-quick-filters" role="group" aria-label="Quick filters">
          {quickFilterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={`board-filter-chip${activeFilters.includes(chip.key) ? ' board-filter-chip-active' : ''}`}
              aria-pressed={activeFilters.includes(chip.key)}
              onClick={() => toggleFilter(chip.key)}
            >
              {chip.cat === 'assignee' ? chip.value : `${chip.value}`}
            </button>
          ))}
          {activeFilters.length > 0 && (
            <button type="button" className="board-filter-clear" onClick={() => setActiveFilters([])}>Clear filters</button>
          )}
        </div>
        <div className="board-swimlane-control">
          <label htmlFor="swimlane-select">Swimlanes</label>
          <select id="swimlane-select" value={swimlaneBy} onChange={(event) => setSwimlaneBy(event.target.value)}>
            {SWIMLANE_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
          </select>
        </div>
        <div className="board-estimation-total" aria-label={`${estimationLabel} total`}>
          <span className="board-estimation-total-label">{estimationLabel}</span>
          <span className="board-estimation-total-value">{estimationTotalDisplay}</span>
        </div>
      </div>

      {/* Board settings panel */}
      {isSettingsOpen && (
        <div className="board-settings-panel" role="dialog" aria-label="Board settings">
          <h3>Board configuration</h3>
          <div className="board-settings-row">
            <label htmlFor="settings-swimlane">Group swimlanes by</label>
            <select id="settings-swimlane" value={swimlaneBy} onChange={(event) => setSwimlaneBy(event.target.value)}>
              {SWIMLANE_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
            </select>
          </div>
          <div className="board-settings-row">
            <label htmlFor="settings-estimation">Estimation statistic</label>
            <select id="settings-estimation" value={estimationStatistic} onChange={(event) => setEstimationStatistic(event.target.value)}>
              {ESTIMATION_STATISTIC_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
            </select>
          </div>
          <div className="board-settings-wip">
            <span className="board-settings-wip-title">WIP limits (per column)</span>
            {STATUS_COLUMNS.map((status) => (
              <div className="board-settings-row" key={status}>
                <label htmlFor={`wip-${status}`}>{status}</label>
                <input
                  id={`wip-${status}`}
                  type="number"
                  min="0"
                  aria-label={`WIP limit for ${status}`}
                  value={wipLimits[status] ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value
                    setWipLimits((current) => {
                      const next = { ...current }
                      if (raw === '') delete next[status]
                      else next[status] = Number(raw)
                      return next
                    })
                  }}
                />
              </div>
            ))}
          </div>
          {/* JL-308: Atlassian-style column configuration */}
          <div className="board-settings-columns" aria-label="Board columns">
            <div className="board-settings-columns-head">
              <span className="board-settings-wip-title">Columns</span>
              <button type="button" className="board-col-add" onClick={addColumn}>Add column</button>
            </div>
            <p className="board-settings-columns-hint">Map each column to one or more workflow statuses. A status belongs to exactly one column.</p>
            <div className="board-col-list">
              {editorColumns.map((col, index) => (
                <div className="board-col-editor" key={col.id} data-col-id={col.id}>
                  <div className="board-col-editor-head">
                    <input
                      className="board-col-name-input"
                      aria-label={`Column ${index + 1} name`}
                      value={col.name}
                      onChange={(event) => renameColumn(col.id, event.target.value)}
                    />
                    <div className="board-col-editor-actions">
                      <button type="button" aria-label={`Move column ${index + 1} left`} disabled={index === 0} onClick={() => moveColumn(col.id, -1)}>&#8592;</button>
                      <button type="button" aria-label={`Move column ${index + 1} right`} disabled={index === editorColumns.length - 1} onClick={() => moveColumn(col.id, 1)}>&#8594;</button>
                      <button type="button" className="board-col-remove" aria-label={`Remove column ${index + 1}`} onClick={() => removeColumn(col.id)}>&times;</button>
                    </div>
                  </div>
                  <div className="board-col-statuses">
                    {(col.statuses || []).map((status) => (
                      <span className="board-col-status-chip" key={status}>
                        {status}
                        <button type="button" aria-label={`Remove status ${status} from column ${index + 1}`} onClick={() => unassignStatus(col.id, status)}>&times;</button>
                      </span>
                    ))}
                    {unmappedStatuses.length > 0 && (
                      <select
                        className="board-col-status-add"
                        aria-label={`Add status to column ${index + 1}`}
                        value=""
                        onChange={(event) => { assignStatus(col.id, event.target.value); event.target.value = '' }}
                      >
                        <option value="">+ Add status</option>
                        {unmappedStatuses.map((status) => (<option key={status} value={status}>{status}</option>))}
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="board-col-unmapped" aria-label="Unmapped statuses">
              <span className="board-col-unmapped-label">Unmapped</span>
              {unmappedStatuses.length === 0
                ? <span className="board-col-unmapped-empty">All statuses mapped</span>
                : unmappedStatuses.map((status) => (<span className="board-col-status-chip board-col-status-chip-unmapped" key={status}>{status}</span>))}
            </div>
          </div>

          <div className="board-settings-actions">
            {canManageProjectSettings ? (
              <button type="button" className="board-settings-save" onClick={handleSaveConfig}>Save</button>
            ) : (
              <span className="board-settings-readonly">You need admin access to save board settings.</span>
            )}
            <button type="button" className="board-settings-cancel" onClick={() => setIsSettingsOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Swimlanes */}
      {swimlanes.map((lane) => (
        <div className="board-swimlane" key={lane.key} data-swimlane={lane.key}>
          {lane.label !== null && (
            <div className="board-swimlane-label">
              <span className="board-swimlane-name">{lane.label}</span>
              <span className="board-swimlane-count">{lane.issues.length}</span>
            </div>
          )}
          <div className="kanban-grid">
            {boardColumns.map((col) => {
              const colIssues = lane.issues.filter((issue) => col.statuses.includes(issue.status))
              const limit = wipLimits[col.name]
              const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0
              const isOverLimit = hasLimit && colIssues.length > Number(limit)
              return (
                <article
                  key={col.id}
                  className={`kanban-col${dropColId === col.id ? ' kanban-col-drop-active' : ''}${isOverLimit ? ' kanban-col-over-wip' : ''}`}
                  data-column={col.name}
                  onDragOver={(event) => { event.preventDefault(); if (dropColId !== col.id) setDropColId(col.id) }}
                  onDrop={() => handleDrop(col)}
                >
                  <header>
                    <h3>{col.name}</h3>
                    <span className={`kanban-count${isOverLimit ? ' kanban-count-over' : ''}`} data-status={col.name}>
                      {colIssues.length}{hasLimit ? ` / ${limit}` : ''}
                    </span>
                  </header>
                  {colIssues.map((issue) => (
                    <div
                      className={`card kanban-card-draggable${issue.flagged ? ' kanban-card-flagged' : ''}`}
                      key={issue.id}
                      draggable={canEditIssue}
                      onDragStart={canEditIssue ? () => setDragIssueId(issue.id) : undefined}
                      onDragEnd={canEditIssue ? () => { setDragIssueId(null); setDropColId('') } : undefined}
                    >
                      <button className="issue-link" type="button" onClick={() => navigate(`/issues/${issue.id}`)}>{issue.key}</button>
                      {issue.flagged && <ImpedimentFlagIndicator className="kanban-card-flag" />}
                      <h4>{issue.title}</h4>
                      <p>{issue.issueType}</p>
                      <DueDateBadge dueDate={issue.dueDate} status={issue.status} />
                      {canEditIssue ? (
                        <select value={issue.status} onChange={(event) => handleMove(issue.id, event.target.value, issue.sprintId ?? null)}>
                          {ISSUE_STATUSES.map((item) => (<option key={item} value={item}>{item}</option>))}
                        </select>
                      ) : (
                        <span className="kanban-status-readonly" aria-label={`Status for ${issue.key}`}>{issue.status}</span>
                      )}
                    </div>
                  ))}
                </article>
              )
            })}
          </div>
        </div>
      ))}
      {confirmDialog}
    </section>
  )
}
