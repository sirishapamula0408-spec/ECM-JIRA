import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Chip from '@mui/material/Chip'
import Select from '@mui/material/Select'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import { useIssues } from '../../context/IssueContext'
import { useSprints } from '../../context/SprintContext'
import { useMembers } from '../../context/MemberContext'
import './BacklogPage.css'
import { ISSUE_STATUSES, ISSUE_TYPES, PRIORITIES } from '../../constants'
import { BacklogIssueRow } from '../../components/issues/BacklogIssueRow'
import { ImportExportModal } from '../../components/issues/ImportExportModal'
import { BulkChangeWizard } from '../../components/issues/BulkChangeWizard'
import { BacklogFilterMenu } from '../../components/issues/BacklogFilterMenu'
import { SectionCheckbox } from '../../components/issues/SectionCheckbox'
import { bulkChangeIssues } from '../../api/issueApi'
import { fetchProjectStatuses, fetchProjectPriorities } from '../../api/issueConfigApi'
import { fetchProjectLabels } from '../../api/labelApi'
import { fetchProjectDependencies } from '../../api/dependencyApi'
import { watchIssue, unwatchIssue } from '../../api/watcherApi'
import { usePageTitle } from '../../hooks/usePageTitle'
import { initialsFromName } from '../../utils/helpers'
import { usePermissions } from '../../hooks/usePermissions'
import { useConfirm } from '../../components/common/useConfirm'
import { issueHref } from '../../utils/issueRef'
import { sprintsForProject } from '../../utils/sprints'
import { EMPTY_FILTERS, buildFilterOptions, matchesFilters } from '../../utils/backlogFilters'
import {
  BACKLOG_VALUE, UNASSIGNED_VALUE, VALUE_FIELDS, bulkOperation, sectionState, setSection, summarizeBulkResult, toggleId,
} from '../../utils/bulkSelection'

// JL-190: values are names from the project's config; fall back to the
// built-in lists when there is no project in view or the request fails.
const namesOf = (rows, fallback) => {
  const names = Array.isArray(rows) ? rows.map((r) => r?.name).filter(Boolean) : []
  return names.length ? names : fallback
}
const DEFAULT_BULK_CATALOG = { statuses: ISSUE_STATUSES, priorities: PRIORITIES, labels: [] }
// Sub-task is tied to a parent, so it is never a bulk type target (the server refuses it too).
const BULK_ISSUE_TYPES = ISSUE_TYPES.filter((type) => type !== 'Sub-task')

// JL-234 — client-side backlog sort control
const SORT_STORAGE_KEY = 'backlogSort'
const SORT_OPTIONS = [
  { value: '', label: 'Sort: Default' },
  { value: 'priority', label: 'Priority' },
  { value: 'key', label: 'Key' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'storyPoints', label: 'Story points' },
]
const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((priority, index) => [priority, index]))

// JL-353: the three panel metric pills (grey / blue / green) are *category*
// buckets — To Do / In Progress / Done — not exact status matches. The app has
// more statuses than pills (Backlog, Code Review, and the JL-306 QA Lifecycle
// set), so exact matching would silently drop those issues from every pill.
// This mirrors the server's canonical `issue_statuses.category` mapping
// (server/db.js default seeds + the QA Lifecycle workflow template):
//   todo:        Backlog, To Do
//   inprogress:  In Progress, Code Review, In Testing, In Rework, In UAT
//   done:        Done, Cancelled  (Cancelled is terminal, hence done-category,
//                even though boards color it neutrally per JL-312)
// Unknown custom statuses fall back to 'todo' — matching the DB column default
// and BoardPage's defaultCategoryForStatus (JL-311) — so every issue is always
// counted in exactly one pill and the three pills sum to the panel total.
const STATUS_CATEGORY = {
  Backlog: 'todo',
  'To Do': 'todo',
  'In Progress': 'inprogress',
  'Code Review': 'inprogress',
  'In Testing': 'inprogress',
  'In Rework': 'inprogress',
  'In UAT': 'inprogress',
  Done: 'done',
  Cancelled: 'done',
}

function countByStatusCategory(issueList) {
  const counts = { todo: 0, inprogress: 0, done: 0 }
  for (const issue of issueList) {
    counts[STATUS_CATEGORY[issue.status] || 'todo'] += 1
  }
  return counts
}

function loadStoredSort() {
  try {
    const raw = window.localStorage.getItem(SORT_STORAGE_KEY)
    if (!raw) return { field: '', direction: 'asc' }
    const parsed = JSON.parse(raw)
    const field = SORT_OPTIONS.some((option) => option.value === parsed?.field) ? parsed.field : ''
    const direction = parsed?.direction === 'desc' ? 'desc' : 'asc'
    return { field, direction }
  } catch {
    return { field: '', direction: 'asc' }
  }
}

function persistSort(field, direction) {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ field, direction }))
  } catch {
    // localStorage unavailable — sorting still works for this session
  }
}

// Returns the comparable value for a field, or null when missing (missing sorts last).
function sortValue(issue, field) {
  switch (field) {
    case 'priority':
      return PRIORITY_RANK[issue.priority] ?? null
    case 'key':
      return issue.key ? String(issue.key) : null
    case 'assignee':
      return issue.assignee ? String(issue.assignee).toLowerCase() : null
    case 'created': {
      const time = Date.parse(issue.createdAt)
      return Number.isNaN(time) ? null : time
    }
    case 'updated': {
      const time = Date.parse(issue.updatedAt)
      return Number.isNaN(time) ? null : time
    }
    case 'storyPoints': {
      if (issue.storyPoints === null || issue.storyPoints === undefined || issue.storyPoints === '') return null
      const points = Number(issue.storyPoints)
      return Number.isNaN(points) ? null : points
    }
    default:
      return null
  }
}

function sortIssueList(list, field, direction) {
  if (!field) return list
  const dir = direction === 'desc' ? -1 : 1
  return [...list].sort((a, b) => {
    const aValue = sortValue(a, field)
    const bValue = sortValue(b, field)
    // Issues with no value for the chosen field always sort last, regardless of direction.
    if (aValue === null && bValue === null) return 0
    if (aValue === null) return 1
    if (bValue === null) return -1
    const cmp = typeof aValue === 'string'
      ? aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: 'base' })
      : aValue - bValue
    return cmp * dir
  })
}

export function BacklogPage() {
  usePageTitle('Backlog')
  const { confirm, confirmDialog } = useConfirm()
  const { issues, handleMove, handleCreate: onCreateIssue, reloadIssues } = useIssues()
  const { sprints: allSprints, handleCreateSprint: onCreateSprint, handleStartSprint: onStartSprint, handleUpdateSprint: onUpdateSprint, handleDeleteSprint: onDeleteSprint } = useSprints()
  const { profile, members } = useMembers()
  const { projectId } = useParams()
  // JL-165: only this project's sprints (and shared legacy ones).
  const sprints = useMemo(() => sprintsForProject(allSprints, projectId), [allSprints, projectId])
  const defaultAssignee = profile?.full_name || 'Alex Rivera'
  const navigate = useNavigate()
  const scopedIssues = projectId ? issues.filter((issue) => issue.projectId === Number(projectId)) : issues
  const [expandedPanels, setExpandedPanels] = useState({ backlog: true })
  const [selectedIssueIds, setSelectedIssueIds] = useState([])
  // JL-190: '' = nothing chosen yet; Apply needs a field (and, for value
  // fields, a value) as well as a selection.
  const [bulkField, setBulkField] = useState('')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkToast, setBulkToast] = useState(null) // { severity, message }
  const [bulkCatalog, setBulkCatalog] = useState(DEFAULT_BULK_CATALOG)
  const [searchTerm, setSearchTerm] = useState('')
  const [backlogMessage, setBacklogMessage] = useState('')
  const [dragIssueId, setDragIssueId] = useState(null)
  const [dropPanelId, setDropPanelId] = useState('')
  const [quickCreateBySprint, setQuickCreateBySprint] = useState({})
  const [quickCreateTitleBySprint, setQuickCreateTitleBySprint] = useState({})
  const [quickCreateBusyBySprint, setQuickCreateBusyBySprint] = useState({})
  const [quickCreateErrorBySprint, setQuickCreateErrorBySprint] = useState({})
  const [openSprintMenuId, setOpenSprintMenuId] = useState(null)
  const [showImportExport, setShowImportExport] = useState(false)
  const [importExportTab, setImportExportTab] = useState('export')
  const [showBulkWizard, setShowBulkWizard] = useState(false)
  const [dependencies, setDependencies] = useState(null) // JL-128: { byId, edges, cycles, blockedCount }
  const [showMyOpenOnly, setShowMyOpenOnly] = useState(false)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  // JL-234: sort field + direction, restored from localStorage on mount ('' = default order)
  const [sortField, setSortField] = useState(() => loadStoredSort().field)
  const [sortDirection, setSortDirection] = useState(() => loadStoredSort().direction)

  // Import/Export is project-scoped: use the route project, else the project of the visible issues
  const exportProjectId = projectId ? Number(projectId) : (scopedIssues[0]?.projectId ?? null)

  // JL-230: Viewers get a read-only backlog — gate every mutating affordance.
  const { canCreateIssue, canEditIssue, canDeleteIssue, canManageSprints, canExportIssues } = usePermissions(exportProjectId ?? undefined)
  const canBulkEdit = canEditIssue || canDeleteIssue

  const normalizedSearch = searchTerm.trim().toLowerCase()
  // "My open issues" quick filter: only issues assigned to the current user that are not Done
  const currentUserName = profile?.full_name || ''
  // Filter menu + avatar quick filters, AND'd with "My open issues".
  const filterOptions = useMemo(() => buildFilterOptions(scopedIssues), [scopedIssues])
  const visibleIssues = useMemo(
    () => scopedIssues.filter((issue) => (
      (!showMyOpenOnly || (issue.assignee === currentUserName && issue.status !== 'Done'))
      && matchesFilters(issue, filters)
    )),
    [scopedIssues, showMyOpenOnly, currentUserName, filters],
  )

  // JL-190: a selection belongs to what was on screen when it was made, so a
  // new project, search, quick filter or filter starts it over. Adjusted during
  // render (React's alternative to a state-syncing effect).
  const selectionScope = JSON.stringify([projectId ?? null, normalizedSearch, showMyOpenOnly, filters])
  const [selectionScopeSeen, setSelectionScopeSeen] = useState(selectionScope)
  if (selectionScopeSeen !== selectionScope) {
    setSelectionScopeSeen(selectionScope)
    setSelectedIssueIds([])
  }

  // Toolbar avatars toggle an assignee filter. issues.assignee holds either the
  // member's name or email (both forms occur), so a toggle covers both.
  const memberAssigneeValues = (member) => [member.name, member.email].filter(Boolean)
  const isMemberFiltered = (member) => memberAssigneeValues(member).some((value) => filters.assignee.includes(value))
  function toggleMemberFilter(member) {
    const values = memberAssigneeValues(member)
    const selected = isMemberFiltered(member)
    setFilters((current) => ({
      ...current,
      assignee: selected
        ? current.assignee.filter((value) => !values.includes(value))
        : [...current.assignee, ...values.filter((value) => !current.assignee.includes(value))],
    }))
  }
  // JL-234: client-side sort — when no field is chosen the original ordering is untouched
  const sortedVisibleIssues = useMemo(
    () => sortIssueList(visibleIssues, sortField, sortDirection),
    [visibleIssues, sortField, sortDirection],
  )
  const allBacklogItems = sortedVisibleIssues.filter((issue) => issue.status === 'Backlog')
  const allSprintItems = sortedVisibleIssues.filter((issue) => issue.status !== 'Backlog')
  const defaultSprintId = sprints[0]?.id

  useEffect(() => {
    setExpandedPanels((current) => {
      const next = { backlog: current.backlog ?? true }
      for (const sprint of sprints) {
        next[sprint.id] = current[sprint.id] ?? false
      }
      return next
    })
  }, [sprints])

  // JL-128: load dependency graph / blocked-issue flags for the visible project.
  useEffect(() => {
    let cancelled = false
    if (!exportProjectId) { setDependencies(null); return undefined }
    fetchProjectDependencies(exportProjectId)
      .then((data) => {
        if (cancelled) return
        const byId = new Map((data.issues || []).map((i) => [i.id, i]))
        setDependencies({ byId, edges: data.edges || [], cycles: data.cycles || [], summary: data.summary || {} })
      })
      .catch(() => { if (!cancelled) setDependencies(null) })
    return () => { cancelled = true }
  }, [exportProjectId, issues])

  // JL-190: bulk value lists come from the project's own statuses, priorities
  // and labels. Each request falls back on its own, so one failure never
  // empties the other lists.
  useEffect(() => {
    let cancelled = false
    if (!exportProjectId) { setBulkCatalog(DEFAULT_BULK_CATALOG); return undefined }
    Promise.allSettled([
      fetchProjectStatuses(exportProjectId),
      fetchProjectPriorities(exportProjectId),
      fetchProjectLabels(exportProjectId),
    ]).then(([statuses, priorities, labels]) => {
      if (cancelled) return
      setBulkCatalog({
        statuses: namesOf(statuses.value, ISSUE_STATUSES),
        priorities: namesOf(priorities.value, PRIORITIES),
        labels: namesOf(labels.value, []),
      })
    })
    return () => { cancelled = true }
  }, [exportProjectId])

  // JL-190: Esc clears the selection — unless it is closing something else
  // (a menu, the filter popover, a dialog), which owns that keypress.
  const hasSelection = selectedIssueIds.length > 0
  useEffect(() => {
    if (!hasSelection) return undefined
    function handleKeyDown(event) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="presentation"], [role="menu"], [role="listbox"]')) return
      setSelectedIssueIds([])
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [hasSelection])

  const blockedFor = (issueId) => {
    const info = dependencies?.byId.get(issueId)
    return info ? { isBlocked: info.isBlocked, blockedBy: info.blockedBy } : undefined
  }

  const matchesSearch = (issue) => {
    if (!normalizedSearch) return true
    return (
      String(issue.key || '').toLowerCase().includes(normalizedSearch) ||
      String(issue.title || '').toLowerCase().includes(normalizedSearch) ||
      String(issue.assignee || '').toLowerCase().includes(normalizedSearch)
    )
  }

  const backlogItems = allBacklogItems.filter(matchesSearch)
  const backlogIds = backlogItems.map((issue) => issue.id)
  const allBacklogIdSet = new Set(allBacklogItems.map((issue) => issue.id))
  const selectedBacklogIds = selectedIssueIds.filter((id) => allBacklogIdSet.has(id))

  const sprintPanels = sprints.map((sprint) => {
    const sprintIssues = allSprintItems.filter((issue) => issue.sprintId === sprint.id).filter(matchesSearch)
    // JL-353: live To Do / In Progress / Done pill counts (were hardcoded "0").
    return { ...sprint, issues: sprintIssues, issueIds: sprintIssues.map((issue) => issue.id), counts: countByStatusCategory(sprintIssues) }
  })

  // JL-190: only rows actually on screen count as selected, so an issue that
  // was deleted or moved out of view never inflates "N selected" or gets edited.
  const renderedIdSet = new Set([...backlogIds, ...sprintPanels.flatMap((panel) => panel.issueIds)])
  const liveSelectedIds = selectedIssueIds.filter((id) => renderedIdSet.has(id))
  const selectedCount = liveSelectedIds.length
  // JL-353: backlog panel pills come from backlogItems (all Backlog-status, so
  // they land in the todo bucket) — a different source than the sprint panels.
  const backlogCounts = countByStatusCategory(backlogItems)

  function setPanelExpanded(panelId, expanded) {
    setExpandedPanels((current) => ({ ...current, [panelId]: expanded }))
  }

  function handleIssueDragStart(issueId) { setDragIssueId(issueId) }
  function handleIssueDragEnd() { setDragIssueId(null); setDropPanelId('') }

  function handlePanelDragOver(event, panelId) {
    event.preventDefault()
    if (dropPanelId !== panelId) setDropPanelId(panelId)
  }

  async function handlePanelDrop(event, panelId, targetSprintId) {
    event.preventDefault()
    if (!canEditIssue) { setDropPanelId(''); setDragIssueId(null); return }
    const issueId = Number(dragIssueId)
    if (!issueId) { setDropPanelId(''); return }

    const issue = issues.find((item) => item.id === issueId)
    if (!issue) { setDropPanelId(''); setDragIssueId(null); return }

    const currentSprintId = issue.sprintId
    if (panelId === 'backlog') {
      if (issue.status !== 'Backlog') await handleBacklogMove(issue.id, 'Backlog')
    } else {
      const nextStatus = issue.status === 'Backlog' ? 'To Do' : issue.status
      if (currentSprintId !== targetSprintId || issue.status === 'Backlog') {
        await handleBacklogMove(issue.id, nextStatus, targetSprintId)
      }
    }
    setDropPanelId(''); setDragIssueId(null)
  }

  function toggleIssueSelection(issueId) {
    setSelectedIssueIds((current) => toggleId(current, issueId))
  }

  function toggleSectionSelection(sectionIds, checked) {
    setSelectedIssueIds((current) => setSection(current, sectionIds, checked))
  }

  async function handleBacklogMove(issueId, nextStatus, targetSprintId) {
    await handleMove(issueId, nextStatus, targetSprintId)
    setBacklogMessage('')
    if (nextStatus === 'Backlog') setPanelExpanded('backlog', true)
    else setPanelExpanded(targetSprintId || defaultSprintId, true)
  }

  const bulkNeedsValue = VALUE_FIELDS.includes(bulkField)
  const canApplyBulk = selectedCount > 0 && bulkField !== '' && (!bulkNeedsValue || bulkValue !== '') && !bulkBusy

  // After any bulk write: refresh rows and panel counts in place, keep only the
  // failed issues selected (so they can be retried), and report the outcome.
  async function finishBulk(response, verb) {
    const summary = summarizeBulkResult(response, verb)
    await reloadIssues()
    setSelectedIssueIds(summary.failedIds)
    setBulkToast(summary)
    return summary
  }

  // JL-190: one POST /api/issues/bulk for every field edit and for delete. The
  // server applies each issue through the same rules as a single edit and
  // reports per-issue results. Watch/Unwatch are per-user subscriptions with no
  // bulk endpoint, so they still go one request per issue.
  async function applyBulkAction() {
    if (!canApplyBulk) return
    const ids = [...liveSelectedIds]

    if (bulkField === 'delete' && !(await confirm({
      title: 'Delete issues?',
      message: `Delete ${ids.length} work item${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    }))) return

    setBulkBusy(true)
    try {
      if (bulkField === 'watch' || bulkField === 'unwatch') {
        const subscribe = bulkField === 'watch' ? watchIssue : unwatchIssue
        const keyOf = new Map(issues.map((issue) => [issue.id, issue.key]))
        const settled = await Promise.allSettled(ids.map((id) => subscribe(id)))
        const results = settled.map((outcome, index) => ({
          issueId: ids[index],
          key: keyOf.get(ids[index]),
          applied: outcome.status === 'fulfilled',
          error: outcome.status === 'rejected' ? (outcome.reason?.message || 'Request failed') : null,
        }))
        await finishBulk({ results }, bulkField === 'watch' ? 'now watched' : 'no longer watched')
        return
      }

      const response = await bulkChangeIssues({ issueIds: ids, operations: bulkOperation(bulkField, bulkValue) })
      await finishBulk(response, bulkField === 'delete' ? 'deleted' : 'updated')
      // Show where moved issues landed.
      if (bulkField === 'sprint') setPanelExpanded(bulkValue === BACKLOG_VALUE ? 'backlog' : Number(bulkValue), true)
      if (bulkField === 'status' && bulkValue === 'Backlog') setPanelExpanded('backlog', true)
    } catch (error) {
      setBulkToast({ severity: 'error', message: error?.message || 'Bulk update failed' })
    } finally {
      setBulkBusy(false)
    }
  }

  // JL-234: persist the chosen sort so it survives reloads
  function handleSortFieldChange(event) {
    const field = event.target.value
    setSortField(field)
    persistSort(field, sortDirection)
  }

  function toggleSortDirection() {
    const next = sortDirection === 'asc' ? 'desc' : 'asc'
    setSortDirection(next)
    persistSort(sortField, next)
  }

  // Keep the value control in sync with a sensible default when action changes
  // JL-190: a new field never inherits the previous field's value.
  function changeBulkField(field) {
    setBulkField(field)
    setBulkValue('')
  }

  // Sprints that can still take work: unfinished ones in this project's view.
  const openSprints = sprints.filter((sprint) => !sprint.completedAt)
  const bulkValueOptions = {
    status: bulkCatalog.statuses.map((name) => ({ value: name, label: name })),
    priority: bulkCatalog.priorities.map((name) => ({ value: name, label: name })),
    assignee: [
      { value: UNASSIGNED_VALUE, label: 'Unassigned' },
      ...members.map((member) => ({ value: member.name, label: member.name })),
    ],
    sprint: [
      { value: BACKLOG_VALUE, label: 'Backlog' },
      ...openSprints.map((sprint) => ({ value: String(sprint.id), label: sprint.name })),
    ],
    issueType: BULK_ISSUE_TYPES.map((type) => ({ value: type, label: type })),
    labels: bulkCatalog.labels.map((name) => ({ value: name, label: name })),
  }
  const BULK_FIELD_LABELS = { status: 'Status', assignee: 'Assignee', priority: 'Priority', sprint: 'Sprint', issueType: 'Issue type', labels: 'Label' }

  async function createSprintFromSelection() {
    setBacklogMessage('')
    // JL-165: a sprint belongs to a project, so there must be one in view.
    if (!projectId) {
      setBacklogMessage('Open a project to create a sprint in it.')
      return
    }
    const newSprint = await onCreateSprint({ projectId: Number(projectId) })
    const newSprintId = newSprint?.id
    if (!newSprintId) return
    setPanelExpanded(newSprintId, true); setPanelExpanded('backlog', true)
    if (selectedBacklogIds.length === 0) { setBacklogMessage(`${newSprint.name} created.`); return }
    await Promise.all(selectedBacklogIds.map((id) => handleMove(id, 'To Do', newSprintId)))
    setSelectedIssueIds((current) => current.filter((id) => !selectedBacklogIds.includes(id)))
    setBacklogMessage(`${newSprint.name} created with ${selectedBacklogIds.length} issue(s).`)
  }

  async function handleStartSprintAction(sprintId) {
    try {
      await onStartSprint(sprintId, projectId ? Number(projectId) : undefined)
      setPanelExpanded(sprintId, true)
    } catch (err) {
      // JL-124: single-active-sprint guard returns 409 unless parallel sprints are enabled
      if (err?.status === 409) {
        setBacklogMessage(err?.data?.error || 'Another sprint is already active. Enable parallel sprints to start more than one.')
      } else {
        throw err
      }
    }
  }

  async function handleRenameSprint(sprintPanel) {
    const nextName = window.prompt('Sprint name', sprintPanel.name)
    if (!nextName) return
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === sprintPanel.name) return
    await onUpdateSprint(sprintPanel.id, { name: trimmed, dateRange: sprintPanel.dateRange })
    setBacklogMessage(`Renamed to ${trimmed}.`)
  }

  async function handleMoveSprintIssuesToBacklog(sprintPanel) {
    if (!sprintPanel.issueIds.length) return
    await Promise.all(sprintPanel.issueIds.map((issueId) => handleMove(issueId, 'Backlog', null)))
    setBacklogMessage(`Moved ${sprintPanel.issueIds.length} issue(s) to backlog.`)
  }

  async function handleDeleteSprintPanel(sprintPanel) {
    const confirmed = await confirm({
      title: 'Delete sprint?',
      message: `Delete ${sprintPanel.name}? Issues will be moved to backlog.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return
    await onDeleteSprint(sprintPanel.id)
    setPanelExpanded(sprintPanel.id, false)
    setBacklogMessage(`${sprintPanel.name} deleted.`)
  }

  function openQuickCreate(sprintId) {
    setQuickCreateBySprint((c) => ({ ...c, [sprintId]: true }))
    setQuickCreateErrorBySprint((c) => ({ ...c, [sprintId]: '' }))
    setPanelExpanded(sprintId, true)
  }

  function closeQuickCreate(sprintId) {
    setQuickCreateBySprint((c) => ({ ...c, [sprintId]: false }))
    setQuickCreateTitleBySprint((c) => ({ ...c, [sprintId]: '' }))
    setQuickCreateErrorBySprint((c) => ({ ...c, [sprintId]: '' }))
  }

  async function submitQuickCreate(sprintId) {
    const title = String(quickCreateTitleBySprint[sprintId] || '').trim()
    if (!title) { setQuickCreateErrorBySprint((c) => ({ ...c, [sprintId]: 'Summary is required.' })); return }
    setQuickCreateBusyBySprint((c) => ({ ...c, [sprintId]: true }))
    setQuickCreateErrorBySprint((c) => ({ ...c, [sprintId]: '' }))
    try {
      await onCreateIssue({ title, description: title, assignee: defaultAssignee, priority: 'Medium', status: 'To Do', issueType: 'Task', sprintId })
      closeQuickCreate(sprintId); setBacklogMessage('Issue created in sprint.')
    } catch (error) {
      setQuickCreateErrorBySprint((c) => ({ ...c, [sprintId]: error?.message || 'Failed to create issue' }))
    } finally {
      setQuickCreateBusyBySprint((c) => ({ ...c, [sprintId]: false }))
    }
  }

  return (
    <section className="page backlog-page">
      {/* JL-410: see ListPage — this page had no heading element either. */}
      <h1>Backlog</h1>
      <div className="backlog-toolbar">
        <div className="backlog-toolbar-left">
          <input className="backlog-search-input" placeholder="Search backlog..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
          {/* JL-353: real workspace member avatars (previously four hardcoded
              fake initials). Capped at four; hidden entirely when there are no
              members so we never render empty chips. */}
          {members.length > 0 && (
            <div className="backlog-avatars">
              {members.slice(0, 4).map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className={`assignee-chip${isMemberFiltered(member) ? ' is-selected' : ''}`}
                  title={member.name}
                  aria-label={`Filter by assignee ${member.name}`}
                  aria-pressed={isMemberFiltered(member)}
                  onClick={() => toggleMemberFilter(member)}
                >
                  {initialsFromName(member.name)}
                </button>
              ))}
            </div>
          )}
          <BacklogFilterMenu filters={filters} options={filterOptions} onChange={setFilters} />
          <Chip
            label="My open issues"
            size="small"
            clickable
            variant={showMyOpenOnly ? 'filled' : 'outlined'}
            color={showMyOpenOnly ? 'primary' : 'default'}
            onClick={() => setShowMyOpenOnly((current) => !current)}
            aria-pressed={showMyOpenOnly}
          />
          <Select
            native
            size="small"
            value={sortField}
            onChange={handleSortFieldChange}
            inputProps={{ 'aria-label': 'Sort by' }}
            className="backlog-sort-select"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <Tooltip title={sortDirection === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}>
            <span>
              <IconButton
                size="small"
                onClick={toggleSortDirection}
                disabled={!sortField}
                aria-label={`Sort direction: ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
              >
                {sortDirection === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </div>
        <div className="backlog-toolbar-right">
          {canBulkEdit && (
          <div className="backlog-bulk" role="group" aria-label="Bulk change">
            <span className="bulk-count" aria-live="polite">{selectedCount} selected</span>
            {/* JL-190: the controls stay disabled until something is selected;
                the tooltip says why instead of leaving them silently grey. */}
            <Tooltip title={selectedCount === 0 ? 'Select work items to bulk edit' : ''}>
              <span className="bulk-controls">
                <select className="bulk-status-select" value={bulkField} onChange={(event) => changeBulkField(event.target.value)} disabled={selectedCount === 0 || bulkBusy} aria-label="Bulk action">
                  <option value="">Field…</option>
                  {canEditIssue && (
                    <optgroup label="Change">
                      <option value="status">Status</option>
                      <option value="assignee">Assignee</option>
                      <option value="priority">Priority</option>
                      <option value="sprint">Sprint</option>
                      <option value="issueType">Issue type</option>
                      {bulkCatalog.labels.length > 0 && <option value="labels">Add label</option>}
                    </optgroup>
                  )}
                  <optgroup label="Actions">
                    <option value="watch">Watch</option>
                    <option value="unwatch">Unwatch</option>
                    {canDeleteIssue && <option value="delete">Delete</option>}
                  </optgroup>
                </select>
                {bulkNeedsValue && (
                  <select className="bulk-status-select" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} disabled={selectedCount === 0 || bulkBusy} aria-label={`${BULK_FIELD_LABELS[bulkField]} value`}>
                    <option value="">{`Select ${BULK_FIELD_LABELS[bulkField].toLowerCase()}…`}</option>
                    {bulkValueOptions[bulkField].map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                )}
                <button className="btn btn-ghost" type="button" onClick={applyBulkAction} disabled={!canApplyBulk} aria-busy={bulkBusy}>
                  {bulkBusy ? 'Applying…' : 'Apply'}
                </button>
                {canEditIssue && (
                  <button className="btn btn-ghost" type="button" onClick={() => setShowBulkWizard(true)} disabled={selectedCount === 0 || bulkBusy}>Advanced bulk change</button>
                )}
              </span>
            </Tooltip>
          </div>
          )}
          {/* JL-288: Export is a read op — visible to anyone with canExportIssues
              (incl. Viewers). Import stays Member+ (canCreateIssue). */}
          {canExportIssues && (
            <button className="btn btn-ghost" type="button" onClick={() => { setImportExportTab('export'); setShowImportExport(true) }} disabled={!exportProjectId} title={exportProjectId ? 'Export issues' : 'Open a project backlog to export'}>
              Export
            </button>
          )}
          {canCreateIssue && (
            <button className="btn btn-ghost" type="button" onClick={() => { setImportExportTab('import'); setShowImportExport(true) }} disabled={!exportProjectId} title={exportProjectId ? 'Import issues' : 'Open a project backlog to import'}>
              Import
            </button>
          )}
          {/* JL-353: removed the dead "Views"/"Display settings"/"More" icon
              buttons — they rendered literal placeholder text ("chart",
              "settings", "...") and had no onClick or defined behavior. */}
        </div>
      </div>
      {backlogMessage && <p className="backlog-message">{backlogMessage}</p>}

      {dependencies && (dependencies.summary?.blockedCount > 0 || dependencies.cycles.length > 0) && (
        <div className="backlog-dependency-summary" role="status">
          <span className="backlog-dependency-summary-item">
            ⛔ {dependencies.summary.blockedCount} blocked
          </span>
          <span className="backlog-dependency-summary-item">
            {dependencies.edges.length} dependency link{dependencies.edges.length === 1 ? '' : 's'}
          </span>
          {dependencies.cycles.length > 0 && (
            <span
              className="backlog-dependency-summary-item backlog-dependency-cycle"
              title={dependencies.cycles.map((c) => c.join(' → ')).join('; ')}
            >
              ⚠️ {dependencies.cycles.length} dependency cycle{dependencies.cycles.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {showImportExport && exportProjectId && (
        <ImportExportModal
          projectId={exportProjectId}
          canImport={canCreateIssue}
          initialTab={importExportTab}
          onClose={() => setShowImportExport(false)}
          onImported={() => { reloadIssues(); setBacklogMessage('Issues imported.') }}
        />
      )}

      <BulkChangeWizard
        open={showBulkWizard}
        onClose={() => setShowBulkWizard(false)}
        issueIds={liveSelectedIds}
        members={members}
        sprints={openSprints}
        statuses={bulkCatalog.statuses}
        priorities={bulkCatalog.priorities}
        issueTypes={BULK_ISSUE_TYPES}
        onApplied={(response) => finishBulk(response, response?.results?.some((r) => r.deleted) ? 'deleted' : 'updated')}
      />

      {/* JL-190: bulk outcome toast — names the failed keys and reasons. */}
      <Snackbar
        open={Boolean(bulkToast)}
        autoHideDuration={bulkToast?.severity === 'success' ? 4000 : 8000}
        onClose={(_event, reason) => { if (reason !== 'clickaway') setBulkToast(null) }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {bulkToast ? (
          <Alert severity={bulkToast.severity} variant="filled" onClose={() => setBulkToast(null)} sx={{ maxWidth: 640 }}>
            {bulkToast.message}
          </Alert>
        ) : <span />}
      </Snackbar>

      <article className="panel jira-backlog-panel">
        {sprintPanels.map((sprintPanel) => {
          const isExpanded = Boolean(expandedPanels[sprintPanel.id])
          const isStarted = Boolean(sprintPanel.isStarted)
          return (
            <div key={sprintPanel.id} className="sprint-panel-wrap">
              <div
                className={`jira-sprint-row${isExpanded ? ' expanded' : ''}${dropPanelId === sprintPanel.id ? ' drop-target-active' : ''}`}
                onDragOver={(event) => handlePanelDragOver(event, sprintPanel.id)}
                onDrop={(event) => handlePanelDrop(event, sprintPanel.id, sprintPanel.id)}
              >
                <div className="jira-sprint-left">
                  {canBulkEdit && (
                    <SectionCheckbox
                      state={sectionState(selectedIssueIds, sprintPanel.issueIds)}
                      onChange={(checked) => toggleSectionSelection(sprintPanel.issueIds, checked)}
                      label={`Select all ${sprintPanel.name} issues`}
                      disabled={sprintPanel.issueIds.length === 0}
                    />
                  )}
                  <button className={`sprint-toggle${isExpanded ? ' expanded' : ''}`} type="button" aria-label={isExpanded ? `Collapse ${sprintPanel.name}` : `Expand ${sprintPanel.name}`} onClick={() => setPanelExpanded(sprintPanel.id, !isExpanded)}>
                    <span className="sprint-caret" aria-hidden="true" />
                  </button>
                  <div className="jira-sprint-title">
                    <strong>{sprintPanel.name}</strong>
                    <span>{sprintPanel.dateRange} ({sprintPanel.issues.length} work items)</span>
                  </div>
                </div>
                <div className="jira-sprint-metrics">
                  {/* JL-353: live status-category counts (were hardcoded "0"). */}
                  <span className="metric-pill" title="To Do issues">{sprintPanel.counts.todo}</span>
                  <span className="metric-pill metric-pill-blue" title="In-progress issues">{sprintPanel.counts.inprogress}</span>
                  <span className="metric-pill metric-pill-green" title="Done issues">{sprintPanel.counts.done}</span>
                  {canManageSprints && (
                  <button className="btn btn-ghost sprint-action-btn" type="button" onClick={() => handleStartSprintAction(sprintPanel.id)} disabled={isStarted || sprintPanel.issues.length === 0}>
                    {isStarted ? 'Sprint started' : 'Start sprint'}
                  </button>
                  )}
                  {canManageSprints && (
                  <div className="sprint-menu-wrap" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpenSprintMenuId(null) }}>
                    <button className="icon-btn sprint-menu-trigger" type="button" aria-label="Sprint actions" onClick={() => setOpenSprintMenuId((current) => (current === sprintPanel.id ? null : sprintPanel.id))}>...</button>
                    {openSprintMenuId === sprintPanel.id && (
                      <div className="sprint-menu" role="menu">
                        <button className="sprint-menu-item" type="button" onClick={async () => { await handleStartSprintAction(sprintPanel.id); setOpenSprintMenuId(null) }} disabled={isStarted || sprintPanel.issues.length === 0}>Start sprint</button>
                        <button className="sprint-menu-item" type="button" onClick={async () => { await handleRenameSprint(sprintPanel); setOpenSprintMenuId(null) }}>Rename sprint</button>
                        <button className="sprint-menu-item" type="button" onClick={async () => { await handleMoveSprintIssuesToBacklog(sprintPanel); setOpenSprintMenuId(null) }} disabled={sprintPanel.issueIds.length === 0}>Move all to backlog</button>
                        <button className="sprint-menu-item sprint-menu-danger" type="button" onClick={async () => { await handleDeleteSprintPanel(sprintPanel); setOpenSprintMenuId(null) }}>Delete sprint</button>
                      </div>
                    )}
                  </div>
                  )}
                </div>
              </div>

              <div
                className={`sprint-issues${isExpanded ? ' expanded' : ''}${dropPanelId === sprintPanel.id ? ' drop-target-active' : ''}`}
                onDragOver={(event) => handlePanelDragOver(event, sprintPanel.id)}
                onDrop={(event) => handlePanelDrop(event, sprintPanel.id, sprintPanel.id)}
              >
                {isExpanded && (
                  <>
                    {sprintPanel.issues.map((issue) => (
                      <BacklogIssueRow key={`${sprintPanel.id}-${issue.id}`} issue={issue} blocked={blockedFor(issue.id)} canEdit={canEditIssue} onMove={(id, status) => handleBacklogMove(id, status, sprintPanel.id)} onOpen={() => navigate(issueHref(issue))} isSelected={selectedIssueIds.includes(issue.id)} onToggleSelect={toggleIssueSelection} onDragStart={handleIssueDragStart} onDragEnd={handleIssueDragEnd} />
                    ))}
                    {canCreateIssue && quickCreateBySprint[sprintPanel.id] && (
                      <div className="quick-create-row">
                        <input className="quick-create-input" placeholder="What needs to be done?" value={quickCreateTitleBySprint[sprintPanel.id] || ''} onChange={(event) => setQuickCreateTitleBySprint((c) => ({ ...c, [sprintPanel.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitQuickCreate(sprintPanel.id) } else if (event.key === 'Escape') { event.preventDefault(); closeQuickCreate(sprintPanel.id) } }} />
                        <button className="btn btn-primary quick-create-btn" type="button" onClick={() => submitQuickCreate(sprintPanel.id)} disabled={Boolean(quickCreateBusyBySprint[sprintPanel.id])}>Create</button>
                        <button className="btn btn-ghost quick-create-btn" type="button" onClick={() => closeQuickCreate(sprintPanel.id)} disabled={Boolean(quickCreateBusyBySprint[sprintPanel.id])}>Cancel</button>
                        {quickCreateErrorBySprint[sprintPanel.id] && <p className="quick-create-error">{quickCreateErrorBySprint[sprintPanel.id]}</p>}
                      </div>
                    )}
                    {canCreateIssue && (
                      <div className="sprint-inline-create-wrap">
                        <button className="sprint-inline-create" type="button" onClick={() => openQuickCreate(sprintPanel.id)}>
                          <span className="plus-create-content"><span className="plus-create-symbol">+</span><span>Create</span></span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}

        <div className={`jira-backlog-row${expandedPanels.backlog ? ' expanded' : ''}${dropPanelId === 'backlog' ? ' drop-target-active' : ''}`} onDragOver={(event) => handlePanelDragOver(event, 'backlog')} onDrop={(event) => handlePanelDrop(event, 'backlog')}>
          <div className="jira-sprint-left">
            {canBulkEdit && (
              <SectionCheckbox
                state={sectionState(selectedIssueIds, backlogIds)}
                onChange={(checked) => toggleSectionSelection(backlogIds, checked)}
                label="Select all backlog issues"
                disabled={backlogIds.length === 0}
              />
            )}
            <button className={`sprint-toggle${expandedPanels.backlog ? ' expanded' : ''}`} type="button" aria-label={expandedPanels.backlog ? 'Collapse backlog' : 'Expand backlog'} onClick={() => setPanelExpanded('backlog', !expandedPanels.backlog)}>
              <span className="sprint-caret" aria-hidden="true" />
            </button>
            <div className="jira-sprint-title"><strong>Backlog</strong><span>({backlogItems.length} work items)</span></div>
          </div>
          <div className="jira-sprint-metrics">
            {/* JL-353: live status-category counts (were hardcoded "0"). */}
            <span className="metric-pill" title="To Do issues">{backlogCounts.todo}</span>
            <span className="metric-pill metric-pill-blue" title="In-progress issues">{backlogCounts.inprogress}</span>
            <span className="metric-pill metric-pill-green" title="Done issues">{backlogCounts.done}</span>
            {canManageSprints && (
              <button className="btn btn-ghost sprint-action-btn" type="button" onClick={createSprintFromSelection}>Create sprint</button>
            )}
          </div>
        </div>

        <div className={`sprint-issues${expandedPanels.backlog ? ' expanded' : ''}${dropPanelId === 'backlog' ? ' drop-target-active' : ''}`} onDragOver={(event) => handlePanelDragOver(event, 'backlog')} onDrop={(event) => handlePanelDrop(event, 'backlog')}>
          {expandedPanels.backlog && backlogItems.map((issue) => (
            <BacklogIssueRow key={`backlog-${issue.id}`} issue={issue} blocked={blockedFor(issue.id)} canEdit={canEditIssue} onMove={handleBacklogMove} onOpen={() => navigate(issueHref(issue))} isSelected={selectedIssueIds.includes(issue.id)} onToggleSelect={toggleIssueSelection} onDragStart={handleIssueDragStart} onDragEnd={handleIssueDragEnd} />
          ))}
        </div>
      </article>
      {confirmDialog}
    </section>
  )
}
