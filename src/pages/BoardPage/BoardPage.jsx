import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useIssues } from '../../context/IssueContext'
import { usePermissions } from '../../hooks/usePermissions'
import { fetchBoardConfig, saveBoardConfig, ESTIMATION_STATISTIC_OPTIONS } from '../../api/boardConfigApi'
import { fetchProjectLabels, fetchIssueLabels } from '../../api/labelApi'
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
  const [dropStatus, setDropStatus] = useState('')
  const [isBoardMenuOpen, setIsBoardMenuOpen] = useState(false)
  const [boardMessage, setBoardMessage] = useState('')

  // JL-85 board configuration state
  const [swimlaneBy, setSwimlaneBy] = useState('none')
  const [wipLimits, setWipLimits] = useState({})
  // JL-126: configurable estimation statistic (story points / time / count)
  const [estimationStatistic, setEstimationStatistic] = useState('story_points')

  // JL-239: persist the active quick-filter selection per board. The live,
  // per-user selection is stored in localStorage keyed by project so it is
  // restored on reload/remount (board config quick-filters, when saved, act as
  // a shared default seed — see the config load effect below).
  const filtersStorageKey = projectId ? `jira_board_filters_${projectId}` : 'jira_board_filters'
  const hadStoredFiltersRef = useRef(false)
  const [activeFilters, setActiveFilters] = useState(() => { // e.g. ['assignee:Alice', 'type:Bug', 'label:frontend']
    try {
      const raw = window.localStorage.getItem(projectId ? `jira_board_filters_${projectId}` : 'jira_board_filters')
      hadStoredFiltersRef.current = raw != null
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // JL-239: project label catalog (chip source) + issue->label-names map (matching).
  const [projectLabels, setProjectLabels] = useState([])
  const [labelsByIssue, setLabelsByIssue] = useState({})
  // JL-239: debounced free-text filter over summary + key.
  const [textInput, setTextInput] = useState('')
  const [textFilter, setTextFilter] = useState('')

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
        // JL-239: seed active filters from the saved board config only when the
        // user has no personal (localStorage) selection yet — the shared default.
        if (!hadStoredFiltersRef.current && Array.isArray(cfg.quickFilters) && cfg.quickFilters.length) {
          setActiveFilters(cfg.quickFilters)
        }
      })
      .catch(() => { /* fall back to defaults */ })
    return () => { cancelled = true }
  }, [projectId])

  // JL-239: persist the active quick-filter selection per board (per-user).
  useEffect(() => {
    try { window.localStorage.setItem(filtersStorageKey, JSON.stringify(activeFilters)) } catch { /* ignore */ }
  }, [filtersStorageKey, activeFilters])

  // JL-239: load the project label catalog for the Label quick-filter chip row.
  useEffect(() => {
    if (!projectId) { setProjectLabels([]); return }
    let cancelled = false
    fetchProjectLabels(projectId)
      .then((labels) => { if (!cancelled) setProjectLabels(Array.isArray(labels) ? labels : []) })
      .catch(() => { if (!cancelled) setProjectLabels([]) })
    return () => { cancelled = true }
  }, [projectId])

  // JL-239: debounce the free-text input into the applied text filter.
  useEffect(() => {
    const handle = setTimeout(() => setTextFilter(textInput), 250)
    return () => clearTimeout(handle)
  }, [textInput])

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

  // JL-239: Label quick-filter chips from the project label catalog.
  const labelChips = useMemo(
    () => projectLabels.map((label) => ({ cat: 'label', value: label.name, key: `label:${label.name}`, color: label.color })),
    [projectLabels],
  )

  // JL-239: build the issue -> label-names map so label filters can match.
  // Keyed on the current issue id set to refetch when the board changes.
  const issueIdsKey = useMemo(() => filteredIssues.map((issue) => issue.id).join(','), [filteredIssues])
  useEffect(() => {
    const ids = filteredIssues.map((issue) => issue.id)
    if (ids.length === 0) { setLabelsByIssue({}); return }
    let cancelled = false
    Promise.all(
      ids.map((id) =>
        fetchIssueLabels(id)
          .then((labels) => [id, (Array.isArray(labels) ? labels : []).map((l) => l.name)])
          .catch(() => [id, []]),
      ),
    ).then((entries) => { if (!cancelled) setLabelsByIssue(Object.fromEntries(entries)) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueIdsKey])

  // Apply active quick filters + text filter (AND across categories, OR within
  // a category). JL-239 adds the `label` category and the free-text filter, all
  // combining with the existing assignee/type filters.
  const visibleIssues = useMemo(() => {
    const text = textFilter.trim().toLowerCase()
    if (activeFilters.length === 0 && !text) return filteredIssues
    const byCat = {}
    for (const key of activeFilters) {
      const idx = key.indexOf(':')
      const cat = key.slice(0, idx)
      const value = key.slice(idx + 1)
      ;(byCat[cat] ||= []).push(value)
    }
    return filteredIssues.filter((issue) => {
      // Free-text filter over the summary (title) and key.
      if (text) {
        const haystack = `${issue.title || ''} ${issue.key || ''}`.toLowerCase()
        if (!haystack.includes(text)) return false
      }
      for (const [cat, values] of Object.entries(byCat)) {
        if (cat === 'assignee') {
          if (!values.includes(issue.assignee || 'Unassigned')) return false
        } else if (cat === 'type') {
          if (!values.includes(issue.issueType)) return false
        } else if (cat === 'label') {
          const names = labelsByIssue[issue.id] || []
          if (!values.some((v) => names.includes(v))) return false
        }
      }
      return true
    })
  }, [filteredIssues, activeFilters, textFilter, labelsByIssue])

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

  function toggleFilter(key) {
    setActiveFilters((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    )
  }

  async function handleDrop(nextStatus) {
    if (!canEditIssue) return
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

  async function handleSaveConfig() {
    if (!projectId) { setIsSettingsOpen(false); return }
    // Keep only positive integer limits.
    const cleanLimits = {}
    for (const [status, limit] of Object.entries(wipLimits)) {
      const n = Number(limit)
      if (Number.isInteger(n) && n > 0) cleanLimits[status] = n
    }
    try {
      // JL-239: persist the active quick-filter selection as the board's shared default.
      await saveBoardConfig(projectId, { swimlaneBy, wipLimits: cleanLimits, quickFilters: activeFilters, estimationStatistic })
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
          {(activeFilters.length > 0 || textInput) && (
            <button type="button" className="board-filter-clear" onClick={() => { setActiveFilters([]); setTextInput(''); setTextFilter('') }}>Clear filters</button>
          )}
        </div>
        {/* JL-239: free-text filter over summary + key (debounced). */}
        <div className="board-text-filter">
          <label htmlFor="board-text-filter-input" className="visually-hidden">Filter by text</label>
          <input
            id="board-text-filter-input"
            type="search"
            className="board-text-filter-input"
            placeholder="Filter issues..."
            aria-label="Filter issues by text"
            value={textInput}
            onChange={(event) => setTextInput(event.target.value)}
          />
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

      {/* JL-239: Label quick-filter chip row */}
      {labelChips.length > 0 && (
        <div className="board-label-filters" role="group" aria-label="Label filters">
          {labelChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={`board-filter-chip board-label-chip${activeFilters.includes(chip.key) ? ' board-filter-chip-active' : ''}`}
              aria-pressed={activeFilters.includes(chip.key)}
              style={chip.color ? { borderColor: chip.color } : undefined}
              onClick={() => toggleFilter(chip.key)}
            >
              {chip.color && <span className="board-label-chip-dot" style={{ backgroundColor: chip.color }} aria-hidden="true" />}
              {chip.value}
            </button>
          ))}
        </div>
      )}

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
            {STATUS_COLUMNS.map((status) => {
              const colIssues = lane.issues.filter((issue) => issue.status === status)
              const limit = wipLimits[status]
              const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0
              const isOverLimit = hasLimit && colIssues.length > Number(limit)
              return (
                <article
                  key={status}
                  className={`kanban-col${dropStatus === status ? ' kanban-col-drop-active' : ''}${isOverLimit ? ' kanban-col-over-wip' : ''}`}
                  onDragOver={(event) => { event.preventDefault(); if (dropStatus !== status) setDropStatus(status) }}
                  onDrop={() => handleDrop(status)}
                >
                  <header>
                    <h3>{status}</h3>
                    <span className={`kanban-count${isOverLimit ? ' kanban-count-over' : ''}`} data-status={status}>
                      {colIssues.length}{hasLimit ? ` / ${limit}` : ''}
                    </span>
                  </header>
                  {colIssues.map((issue) => (
                    <div
                      className={`card kanban-card-draggable${issue.flagged ? ' kanban-card-flagged' : ''}`}
                      key={issue.id}
                      draggable={canEditIssue}
                      onDragStart={canEditIssue ? () => setDragIssueId(issue.id) : undefined}
                      onDragEnd={canEditIssue ? () => { setDragIssueId(null); setDropStatus('') } : undefined}
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
