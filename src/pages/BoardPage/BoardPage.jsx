import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useIssues } from '../../context/IssueContext'
import { usePermissions } from '../../hooks/usePermissions'
import { fetchBoardConfig, saveBoardConfig, ESTIMATION_STATISTIC_OPTIONS } from '../../api/boardConfigApi'
import { fetchProjectLabels, fetchIssueLabels } from '../../api/labelApi'
import { fetchProjectStatuses } from '../../api/issueConfigApi'
import { STATUS_COLUMNS } from '../../constants'
import { DueDateBadge } from '../../components/issues/DueDateBadge'
import { ImpedimentFlagIndicator } from '../../components/issues/ImpedimentFlag'
import { CopyButton } from '../../components/common/CopyButton'
import { StatusLozenge } from '../../components/common/StatusLozenge'
import { IssueTypeIcon } from '../../components/icons/IssueTypeIcon'
import { avatarStyle } from '../../utils/avatarColour'
import { defaultCategoryForStatus, isCancelStatus } from '../../utils/statusCategory'
import './BoardPage.css'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useConfirm } from '../../components/common/ConfirmDialog'

const SWIMLANE_OPTIONS = [
  { value: 'none', label: 'No swimlanes' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'epic', label: 'Epic' },
  { value: 'priority', label: 'Priority' },
]

// JL-310: minimum resizable column width (px) and localStorage key builder.
const MIN_COL_WIDTH = 200
const DEFAULT_COL_WIDTH = 270

// Classic board statuses used when a project has no custom workflow statuses.
// JL-306 expanded the global ISSUE_STATUSES with QA-lifecycle states, so the board
// keeps its own conservative default (Backlog + the standard STATUS_COLUMNS) rather
// than inheriting every global status; custom projects override this from the API.
const DEFAULT_STATUSES = ['Backlog', ...STATUS_COLUMNS]
function colWidthsStorageKey(projectId) {
  return `board_col_widths_${projectId || 'default'}`
}

// JL-311/JL-312: `defaultCategoryForStatus` and `isCancelStatus` used to live
// here as module-private helpers, which is why JL-384's StatusLozenge had to
// hand-copy them. JL-387 lifted both to `utils/statusCategory` so the board
// column and the card lozenge share one implementation and cannot drift.

// JL-311: derive a board column's category from its mapped statuses' categories
// (loaded per-project via JL-309). Atlassian colors the Done column green, so a
// column is "done" when it has statuses and they are ALL in the done category;
// likewise "inprogress" when all statuses are in-progress. Mixed columns stay
// neutral. `categoryMap` is name→category; unknown statuses fall back by name.
// JL-312: any cancellation status in the column keeps it neutral (no accent).
function columnCategory(statuses, categoryMap) {
  const list = statuses || []
  if (list.some((s) => isCancelStatus(s))) return null
  const cats = list
    .map((s) => categoryMap[s] || defaultCategoryForStatus(s))
    .filter(Boolean)
  if (cats.length === 0) return null
  if (cats.every((c) => c === 'done')) return 'done'
  if (cats.every((c) => c === 'inprogress')) return 'inprogress'
  return null
}

// JL-355: resolve a board column's WIP limit from the persisted status->limit
// map. The board-config server contract keys wipLimits by STATUS
// (server/routes/boardConfig.js), but JL-308 custom columns can be renamed or
// map several statuses — looking limits up by column NAME silently missed for
// any column whose name differs from its status, so saved limits never fired.
// Resolving through the column's mapped statuses keeps the persisted format
// stable (no migration) and makes the default name==status board behave
// exactly as before.
//
// Merged-column rule: a column mapping multiple limited statuses gets the SUM
// of those limits. Each per-status limit expresses how much work that status
// may hold, so a column merging statuses can hold at most their combined
// capacity — summing honors every saved limit. (Min would silently tighten
// limits the admin set; "first" would depend on object iteration order.)
// Statuses without a saved limit contribute nothing; returns null when no
// mapped status carries a limit.
function columnWipLimit(statuses, wipLimits) {
  let total = 0
  let found = false
  for (const status of statuses || []) {
    const n = Number(wipLimits?.[status])
    if (Number.isInteger(n) && n > 0) {
      total += n
      found = true
    }
  }
  return found ? total : null
}

// JL-387: card meta helpers. The board card now carries the same three signals
// the rest of the app already uses — priority dot, assignee avatar and estimate
// — so a column can be scanned for ownership and risk without opening a card.

// The shared `.priority-mark priority-*` dot from styles/shared.css, exactly as
// the backlog row (IssueRow) and the active-sprint card render it, so the three
// screens agree. An issue with no priority is treated as Medium, matching
// ActiveSprintPage.
function priorityMarkClass(priority) {
  return `priority-mark priority-${String(priority || 'Medium').toLowerCase()}`
}

// Two-letter initials, as the backlog row's avatar uses.
function assigneeInitials(assignee) {
  return String(assignee || '').trim().slice(0, 2).toUpperCase()
}

// A story-point value is only shown when the issue actually has one. Null/blank
// renders nothing at all — a placeholder dash is noise on a dense card.
function storyPointsDisplay(storyPoints) {
  if (storyPoints === null || storyPoints === undefined || storyPoints === '') return null
  const n = Number(storyPoints)
  return Number.isFinite(n) ? n : null
}

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
  // JL-308: Atlassian-style column configuration ([{ id, name, statuses[] }]).
  // Empty = fall back to the default one-column-per-workflow-status board.
  const [columns, setColumns] = useState([])
  // JL-309: the project's actual workflow status names (from GET /api/projects/:id/statuses).
  // Sourced per-project so the columns editor + board grouping reflect custom
  // workflows; falls back to the standard ISSUE_STATUSES set when the project has
  // no custom statuses configured (empty/absent response or fetch failure).
  const [projectStatuses, setProjectStatuses] = useState(DEFAULT_STATUSES)
  // JL-311: name→category map from the per-project statuses, used to color
  // columns (Done = green) by their mapped statuses' category.
  const [statusCategories, setStatusCategories] = useState({})
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

  // JL-310: per-column widths (map of columnId -> px). Persisted in localStorage
  // keyed per board so each project's board layout is remembered independently.
  const [colWidths, setColWidths] = useState({})
  // Tracks an in-flight resize drag so pointermove/up handlers stay scoped to it.
  const resizeRef = useRef(null)

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
        setColumns(Array.isArray(cfg.columns) ? cfg.columns : [])
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

  // JL-309: load the project's effective workflow statuses. The endpoint returns
  // rows shaped like { id, name, position, color, category }; we take the ordered
  // names. When the project has no statuses (empty response) or the fetch fails,
  // keep the standard ISSUE_STATUSES fallback so existing boards are unaffected.
  useEffect(() => {
    if (!projectId) { setProjectStatuses(DEFAULT_STATUSES); setStatusCategories({}); return }
    let cancelled = false
    fetchProjectStatuses(projectId)
      .then((rows) => {
        if (cancelled) return
        const list = Array.isArray(rows) ? rows : []
        const names = list.map((row) => (typeof row === 'string' ? row : row?.name)).filter(Boolean)
        // Build a name→category map from the row objects (JL-311).
        const cats = {}
        for (const row of list) {
          if (row && typeof row === 'object' && row.name && row.category) cats[row.name] = row.category
        }
        setStatusCategories(cats)
        setProjectStatuses(names.length > 0 ? names : DEFAULT_STATUSES)
      })
      .catch(() => { if (!cancelled) { setProjectStatuses(DEFAULT_STATUSES); setStatusCategories({}) } })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    try { window.localStorage.setItem('jira_board_starred', isBoardStarred ? '1' : '0') } catch { /* ignore */ }
  }, [isBoardStarred])

  // JL-310: restore persisted per-column widths for this board on load / project change.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(colWidthsStorageKey(projectId))
      const parsed = raw ? JSON.parse(raw) : null
      setColWidths(parsed && typeof parsed === 'object' ? parsed : {})
    } catch { setColWidths({}) }
  }, [projectId])

  // JL-310: begin a column resize drag. Scoped to the trailing-edge handle so it
  // never interferes with card drag-and-drop. Widths persist to localStorage on release.
  function startColumnResize(event, colId, element) {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = element?.getBoundingClientRect().width || colWidths[colId] || DEFAULT_COL_WIDTH
    resizeRef.current = { colId, startX, startWidth }
    document.body.classList.add('board-col-resizing')

    const onMove = (moveEvent) => {
      const state = resizeRef.current
      if (!state) return
      const next = Math.max(MIN_COL_WIDTH, Math.round(state.startWidth + (moveEvent.clientX - state.startX)))
      setColWidths((current) => ({ ...current, [state.colId]: next }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('board-col-resizing')
      resizeRef.current = null
      setColWidths((current) => {
        try { window.localStorage.setItem(colWidthsStorageKey(projectId), JSON.stringify(current)) } catch { /* ignore */ }
        return current
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

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

  // JL-309: default one-column-per-status set derived from the project's own
  // workflow statuses (Backlog excluded, mirroring the historical STATUS_COLUMNS
  // default). Falls back to STATUS_COLUMNS when the project has no custom
  // statuses, keeping existing boards unchanged.
  const defaultColumnStatuses = useMemo(() => {
    const names = projectStatuses.filter((status) => status !== 'Backlog')
    return names.length > 0 ? names : STATUS_COLUMNS
  }, [projectStatuses])

  // JL-308: the columns actually rendered on the board. When no column config
  // is saved, fall back to the historical default: one column per non-backlog
  // workflow status.
  const boardColumns = useMemo(() => {
    // JL-311: tag each column with its category (done/inprogress/null) so the
    // board can color it (Done = green) via the kanban-col-cat-* class.
    const withCategory = (col) => ({ ...col, category: columnCategory(col.statuses, statusCategories) })
    if (Array.isArray(columns) && columns.length > 0) {
      return columns.map((col) => withCategory({ id: col.id, name: col.name, statuses: col.statuses || [] }))
    }
    return defaultColumnStatuses.map((status) => withCategory({ id: status, name: status, statuses: [status] }))
  }, [columns, defaultColumnStatuses, statusCategories])

  // Materialised columns for the settings editor — defaults are shown so an
  // admin can start from the current board rather than a blank slate.
  const editorColumns = useMemo(() => (
    Array.isArray(columns) && columns.length > 0
      ? columns
      : defaultColumnStatuses.map((status) => ({ id: status, name: status, statuses: [status] }))
  ), [columns, defaultColumnStatuses])

  // Workflow statuses not mapped to any column (Jira's backlog/unmapped area).
  // JL-309: sourced from the project's effective statuses rather than the
  // hardcoded ISSUE_STATUSES constant.
  const unmappedStatuses = useMemo(() => {
    const mapped = new Set(editorColumns.flatMap((col) => col.statuses || []))
    return projectStatuses.filter((status) => !mapped.has(status))
  }, [editorColumns, projectStatuses])

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
      // JL-239: persist the active quick-filter selection as the board's shared default.
      await saveBoardConfig(projectId, { swimlaneBy, wipLimits: cleanLimits, quickFilters: activeFilters, estimationStatistic, columns })
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
            <button className="board-jira-action-btn board-jira-action-btn-boxed" type="button" aria-label="More actions" title="More actions" onClick={() => setIsBoardMenuOpen((c) => !c)}>...</button>
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
            {/* JL-355: limits are keyed by workflow status (the server contract);
                a column's effective limit is the sum of its mapped statuses' limits. */}
            <span className="board-settings-wip-title">WIP limits (per status)</span>
            {defaultColumnStatuses.map((status) => (
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
              // JL-355: limits are persisted keyed by status, so resolve the
              // column's limit through its mapped statuses (not its name).
              const limit = columnWipLimit(col.statuses, wipLimits)
              const hasLimit = limit != null
              const isOverLimit = hasLimit && colIssues.length > limit
              const width = colWidths[col.id]
              // JL-391: the card LIST is the scroll container, so this renders
              // every issue in the column — nothing is withheld and the header
              // count / JL-355 over-WIP check above keep reading the same whole
              // `colIssues` array they always did.
              return (
                <article
                  key={col.id}
                  className={`kanban-col${col.category ? ` kanban-col-cat-${col.category}` : ''}${dropColId === col.id ? ' kanban-col-drop-active' : ''}${isOverLimit ? ' kanban-col-over-wip' : ''}`}
                  data-column={col.name}
                  style={width ? { flex: `0 0 ${width}px`, width: `${width}px` } : undefined}
                  onDragOver={(event) => { event.preventDefault(); if (dropColId !== col.id) setDropColId(col.id) }}
                  onDrop={() => handleDrop(col)}
                >
                  <header>
                    <h3>{col.name}</h3>
                    <span className={`kanban-count${isOverLimit ? ' kanban-count-over' : ''}`} data-status={col.name}>
                      {colIssues.length}{hasLimit ? ` / ${limit}` : ''}
                    </span>
                  </header>
                  {/* JL-391: the bounded, scrollable card list. It deliberately
                      starts AFTER </header> — the header carries the issue count
                      and the JL-355 WIP indicator, and both have to stay pinned
                      in view while the cards scroll under them. Scrolling the
                      whole <article> instead would take them with it.
                      `kanban-col-cards-laned` switches the height bound for the
                      multi-swimlane case (see BoardPage.css). */}
                  <div className={`kanban-col-cards${lane.label !== null ? ' kanban-col-cards-laned' : ''}`} data-column-cards={col.name}>
                    {colIssues.map((issue) => {
                      // JL-387: the card is three rows — key row, title row, meta
                      // row — instead of the old five-block stack whose native
                      // <select> made every card ~40% taller than it needed to be.
                      const points = storyPointsDisplay(issue.storyPoints)
                      const assignee = issue.assignee ? String(issue.assignee) : ''
                      return (
                        <div
                          className={`card kanban-card-draggable${issue.flagged ? ' kanban-card-flagged' : ''}`}
                          key={issue.id}
                          draggable={canEditIssue}
                          onDragStart={canEditIssue ? () => setDragIssueId(issue.id) : undefined}
                          onDragEnd={canEditIssue ? () => { setDragIssueId(null); setDropColId('') } : undefined}
                        >
                          <div className="kanban-card-top">
                            <button className="issue-link" type="button" onClick={() => navigate(`/issues/${issue.id}`)}>{issue.key}</button>
                            <CopyButton
                              className="kanban-copy-key"
                              value={issue.key}
                              title={`Copy issue key ${issue.key}`}
                              ariaLabel={`Copy issue key ${issue.key}`}
                            />
                            {issue.flagged && <ImpedimentFlagIndicator className="kanban-card-flag" />}
                            {/* The due badge moves onto the key row: it was on a
                                line of its own, costing height for one small chip. */}
                            <DueDateBadge dueDate={issue.dueDate} status={issue.status} />
                          </div>
                          <h4 className="kanban-card-title">
                            {/* JL-385: the type is a coloured glyph now, not a
                                whole line of grey body text under the title. */}
                            <IssueTypeIcon type={issue.issueType} />
                            <span className="kanban-card-title-text">{issue.title}</span>
                          </h4>
                          <div className="kanban-card-meta">
                            {/* JL-384: the lozenge takes the board's own
                                per-project category map, so its colour can never
                                disagree with the column heading above it. The
                                read-only variant keeps the historical
                                `.kanban-status-readonly` hook so RBAC styling and
                                the viewer-path assertions still work. */}
                            <StatusLozenge
                              className={`kanban-card-status${canEditIssue ? '' : ' kanban-status-readonly'}`}
                              status={issue.status}
                              transitions={projectStatuses}
                              categoryMap={statusCategories}
                              context={issue.key}
                              readOnly={!canEditIssue}
                              onChange={(next) => handleMove(issue.id, next, issue.sprintId ?? null)}
                            />
                            <span
                              className={priorityMarkClass(issue.priority)}
                              role="img"
                              aria-label={`Priority: ${issue.priority || 'Medium'}`}
                              title={issue.priority || 'Medium'}
                            />
                            {points !== null && (
                              <span
                                className="kanban-card-points"
                                aria-label={`Story points: ${points}`}
                                title={`Story points: ${points}`}
                              >
                                {points}
                              </span>
                            )}
                            {/* JL-386: colour derived from the person, so a column
                                of avatars is scannable instead of uniformly blue.
                                Unassigned gets no derived colour — it is not a
                                person — just the neutral placeholder. */}
                            {assignee ? (
                              <span
                                className="member-avatar kanban-card-avatar"
                                style={avatarStyle(assignee)}
                                title={assignee}
                                aria-label={`Assignee: ${assignee}`}
                              >
                                {assigneeInitials(assignee)}
                              </span>
                            ) : (
                              <span
                                className="member-avatar kanban-card-avatar kanban-card-avatar-unassigned"
                                title="Unassigned"
                                aria-label="Unassigned"
                              >
                                ?
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div
                    className="kanban-col-resize-handle"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize column ${col.name}`}
                    title="Drag to resize column"
                    draggable={false}
                    onPointerDown={(event) => startColumnResize(event, col.id, event.currentTarget.closest('.kanban-col'))}
                    onClick={(event) => event.stopPropagation()}
                  />
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
