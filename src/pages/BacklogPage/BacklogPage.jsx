import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Chip from '@mui/material/Chip'
import { useIssues } from '../../context/IssueContext'
import { useSprints } from '../../context/SprintContext'
import { useMembers } from '../../context/MemberContext'
import './BacklogPage.css'
import { ISSUE_STATUSES, PRIORITIES } from '../../constants'
import { TopNavIcon } from '../../components/icons/TopNavIcon'
import { BacklogIssueRow } from '../../components/issues/BacklogIssueRow'
import { ImportExportModal } from '../../components/issues/ImportExportModal'
import { BulkChangeWizard } from '../../components/issues/BulkChangeWizard'
import { fetchProjectDependencies } from '../../api/dependencyApi'
import { watchIssue, unwatchIssue } from '../../api/watcherApi'
import { usePageTitle } from '../../hooks/usePageTitle'
import { usePermissions } from '../../hooks/usePermissions'
import { useConfirm } from '../../components/common/ConfirmDialog'

export function BacklogPage() {
  usePageTitle('Backlog')
  const { confirm, confirmDialog } = useConfirm()
  const { issues, handleMove, handleUpdate, handleDelete, handleCreate: onCreateIssue, reloadIssues } = useIssues()
  const { sprints, handleCreateSprint: onCreateSprint, handleStartSprint: onStartSprint, handleUpdateSprint: onUpdateSprint, handleDeleteSprint: onDeleteSprint } = useSprints()
  const { profile, members } = useMembers()
  const { projectId } = useParams()
  const defaultAssignee = profile?.full_name || 'Alex Rivera'
  const navigate = useNavigate()
  const scopedIssues = projectId ? issues.filter((issue) => issue.projectId === Number(projectId)) : issues
  const [expandedPanels, setExpandedPanels] = useState({ backlog: true })
  const [selectedIssueIds, setSelectedIssueIds] = useState([])
  const [bulkAction, setBulkAction] = useState('status')
  const [bulkValue, setBulkValue] = useState('To Do')
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
  const [showBulkWizard, setShowBulkWizard] = useState(false)
  const [dependencies, setDependencies] = useState(null) // JL-128: { byId, edges, cycles, blockedCount }
  const [showMyOpenOnly, setShowMyOpenOnly] = useState(false)

  // Import/Export is project-scoped: use the route project, else the project of the visible issues
  const exportProjectId = projectId ? Number(projectId) : (scopedIssues[0]?.projectId ?? null)

  // JL-230: Viewers get a read-only backlog — gate every mutating affordance.
  const { canCreateIssue, canEditIssue, canDeleteIssue, canManageSprints } = usePermissions(exportProjectId ?? undefined)
  const canBulkEdit = canEditIssue || canDeleteIssue

  const normalizedSearch = searchTerm.trim().toLowerCase()
  // "My open issues" quick filter: only issues assigned to the current user that are not Done
  const currentUserName = profile?.full_name || ''
  const visibleIssues = showMyOpenOnly
    ? scopedIssues.filter((issue) => issue.assignee === currentUserName && issue.status !== 'Done')
    : scopedIssues
  const allBacklogItems = visibleIssues.filter((issue) => issue.status === 'Backlog')
  const allSprintItems = visibleIssues.filter((issue) => issue.status !== 'Backlog')
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
  const selectedCount = selectedIssueIds.length
  const allBacklogIdSet = new Set(allBacklogItems.map((issue) => issue.id))
  const selectedBacklogIds = selectedIssueIds.filter((id) => allBacklogIdSet.has(id))

  const sprintPanels = sprints.map((sprint) => {
    const sprintIssues = allSprintItems.filter((issue) => issue.sprintId === sprint.id).filter(matchesSearch)
    return { ...sprint, issues: sprintIssues, issueIds: sprintIssues.map((issue) => issue.id) }
  })

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
    setSelectedIssueIds((current) =>
      current.includes(issueId) ? current.filter((id) => id !== issueId) : [...current, issueId],
    )
  }

  function toggleSectionSelection(sectionIds, checked) {
    setSelectedIssueIds((current) => {
      if (checked) return Array.from(new Set([...current, ...sectionIds]))
      return current.filter((id) => !sectionIds.includes(id))
    })
  }

  async function handleBacklogMove(issueId, nextStatus, targetSprintId) {
    await handleMove(issueId, nextStatus, targetSprintId)
    setBacklogMessage('')
    if (nextStatus === 'Backlog') setPanelExpanded('backlog', true)
    else setPanelExpanded(targetSprintId || defaultSprintId, true)
  }

  async function applyBulkAction() {
    if (selectedIssueIds.length === 0) return
    const ids = [...selectedIssueIds]

    if (bulkAction === 'delete') {
      if (!(await confirm({
        title: 'Delete issues?',
        message: `Delete ${ids.length} issue(s)? This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      }))) return
      await Promise.all(ids.map((id) => handleDelete(id)))
      setSelectedIssueIds([])
      setBacklogMessage(`Deleted ${ids.length} issue(s).`)
      return
    }

    if (bulkAction === 'watch') {
      await Promise.all(ids.map((id) => watchIssue(id)))
      setSelectedIssueIds([])
      setBacklogMessage(`Now watching ${ids.length} issue(s).`)
      return
    }

    if (bulkAction === 'unwatch') {
      await Promise.all(ids.map((id) => unwatchIssue(id)))
      setSelectedIssueIds([])
      setBacklogMessage(`Stopped watching ${ids.length} issue(s).`)
      return
    }

    if (bulkAction === 'status') {
      await Promise.all(ids.map((id) => handleMove(id, bulkValue, bulkValue === 'Backlog' ? null : defaultSprintId)))
      setPanelExpanded(bulkValue === 'Backlog' ? 'backlog' : defaultSprintId, true)
    } else if (bulkAction === 'sprint') {
      const targetSprintId = bulkValue === '' ? null : Number(bulkValue)
      await Promise.all(ids.map((id) => handleMove(id, targetSprintId ? 'To Do' : 'Backlog', targetSprintId)))
      setPanelExpanded(targetSprintId || 'backlog', true)
    } else if (bulkAction === 'assignee') {
      await Promise.all(ids.map((id) => handleUpdate(id, { assignee: bulkValue })))
    } else if (bulkAction === 'priority') {
      await Promise.all(ids.map((id) => handleUpdate(id, { priority: bulkValue })))
    }
    setSelectedIssueIds([])
    setBacklogMessage(`Updated ${ids.length} issue(s).`)
  }

  // Keep the value control in sync with a sensible default when action changes
  function changeBulkAction(action) {
    setBulkAction(action)
    if (action === 'status') setBulkValue('To Do')
    else if (action === 'priority') setBulkValue('Medium')
    else if (action === 'assignee') setBulkValue(members[0]?.name || '')
    else if (action === 'sprint') setBulkValue(String(defaultSprintId ?? ''))
    else setBulkValue('')
  }

  async function createSprintFromSelection() {
    setBacklogMessage('')
    const newSprint = await onCreateSprint()
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
      <div className="backlog-toolbar">
        <div className="backlog-toolbar-left">
          <input className="backlog-search-input" placeholder="Search backlog..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
          <div className="backlog-avatars">
            <span className="assignee-chip">P</span>
            <span className="assignee-chip">HK</span>
            <span className="assignee-chip">SS</span>
            <span className="assignee-chip">S</span>
          </div>
          <button className="btn btn-ghost backlog-filter-btn" type="button">
            <span className="filter-glyph" aria-hidden="true"><TopNavIcon name="filter" /></span>
            Filter
          </button>
          <Chip
            label="My open issues"
            size="small"
            clickable
            variant={showMyOpenOnly ? 'filled' : 'outlined'}
            color={showMyOpenOnly ? 'primary' : 'default'}
            onClick={() => setShowMyOpenOnly((current) => !current)}
            aria-pressed={showMyOpenOnly}
          />
        </div>
        <div className="backlog-toolbar-right">
          {canBulkEdit && (
          <div className="backlog-bulk">
            <span className="bulk-count">{selectedCount} selected</span>
            <select className="bulk-status-select" value={bulkAction} onChange={(event) => changeBulkAction(event.target.value)} disabled={selectedCount === 0} aria-label="Bulk action">
              <option value="status">Status</option>
              <option value="assignee">Assignee</option>
              <option value="priority">Priority</option>
              <option value="sprint">Sprint</option>
              <option value="watch">Watch</option>
              <option value="unwatch">Unwatch</option>
              {canDeleteIssue && <option value="delete">Delete</option>}
            </select>
            {bulkAction === 'status' && (
              <select className="bulk-status-select" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} disabled={selectedCount === 0} aria-label="Status value">
                {ISSUE_STATUSES.map((status) => (<option key={status} value={status}>{status.toUpperCase()}</option>))}
              </select>
            )}
            {bulkAction === 'priority' && (
              <select className="bulk-status-select" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} disabled={selectedCount === 0} aria-label="Priority value">
                {PRIORITIES.map((p) => (<option key={p} value={p}>{p}</option>))}
              </select>
            )}
            {bulkAction === 'assignee' && (
              <select className="bulk-status-select" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} disabled={selectedCount === 0} aria-label="Assignee value">
                {members.map((m) => (<option key={m.id} value={m.name}>{m.name}</option>))}
              </select>
            )}
            {bulkAction === 'sprint' && (
              <select className="bulk-status-select" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} disabled={selectedCount === 0} aria-label="Sprint value">
                <option value="">Backlog</option>
                {sprints.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            )}
            <button className="btn btn-ghost" type="button" onClick={applyBulkAction} disabled={selectedCount === 0}>Apply</button>
            <button className="btn btn-ghost" type="button" onClick={() => setShowBulkWizard(true)} disabled={selectedCount === 0}>Advanced bulk change</button>
          </div>
          )}
          {canCreateIssue && (
            <button className="btn btn-ghost" type="button" onClick={() => setShowImportExport(true)} disabled={!exportProjectId} title={exportProjectId ? 'Import / Export issues' : 'Open a project backlog to import/export'}>
              Import / Export
            </button>
          )}
          <button className="icon-btn" type="button" aria-label="Views">chart</button>
          <button className="icon-btn" type="button" aria-label="Display settings">settings</button>
          <button className="icon-btn" type="button" aria-label="More">...</button>
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
          onClose={() => setShowImportExport(false)}
          onImported={() => { reloadIssues(); setBacklogMessage('Issues imported.') }}
        />
      )}

      <BulkChangeWizard
        open={showBulkWizard}
        onClose={() => setShowBulkWizard(false)}
        issueIds={selectedIssueIds}
        members={members}
        sprints={sprints}
        onApplied={() => { reloadIssues(); setSelectedIssueIds([]); setBacklogMessage('Bulk change applied.') }}
      />

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
                    <input className="backlog-checkbox" type="checkbox" checked={sprintPanel.issueIds.length > 0 && sprintPanel.issueIds.every((id) => selectedIssueIds.includes(id))} onChange={(event) => toggleSectionSelection(sprintPanel.issueIds, event.target.checked)} aria-label={`Select all ${sprintPanel.name} issues`} />
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
                  <span className="metric-pill">0</span>
                  <span className="metric-pill metric-pill-blue">0</span>
                  <span className="metric-pill metric-pill-green">0</span>
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
                      <BacklogIssueRow key={`${sprintPanel.id}-${issue.id}`} issue={issue} blocked={blockedFor(issue.id)} canEdit={canEditIssue} onMove={(id, status) => handleBacklogMove(id, status, sprintPanel.id)} onOpen={() => navigate(`/issues/${issue.id}`)} isSelected={selectedIssueIds.includes(issue.id)} onToggleSelect={toggleIssueSelection} onDragStart={handleIssueDragStart} onDragEnd={handleIssueDragEnd} />
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
              <input className="backlog-checkbox" type="checkbox" checked={backlogIds.length > 0 && backlogIds.every((id) => selectedIssueIds.includes(id))} onChange={(event) => toggleSectionSelection(backlogIds, event.target.checked)} aria-label="Select all backlog issues" />
            )}
            <button className={`sprint-toggle${expandedPanels.backlog ? ' expanded' : ''}`} type="button" aria-label={expandedPanels.backlog ? 'Collapse backlog' : 'Expand backlog'} onClick={() => setPanelExpanded('backlog', !expandedPanels.backlog)}>
              <span className="sprint-caret" aria-hidden="true" />
            </button>
            <div className="jira-sprint-title"><strong>Backlog</strong><span>({backlogItems.length} work items)</span></div>
          </div>
          <div className="jira-sprint-metrics">
            <span className="metric-pill">0</span>
            <span className="metric-pill metric-pill-blue">0</span>
            <span className="metric-pill metric-pill-green">0</span>
            {canManageSprints && (
              <button className="btn btn-ghost sprint-action-btn" type="button" onClick={createSprintFromSelection}>Create sprint</button>
            )}
          </div>
        </div>

        <div className={`sprint-issues${expandedPanels.backlog ? ' expanded' : ''}${dropPanelId === 'backlog' ? ' drop-target-active' : ''}`} onDragOver={(event) => handlePanelDragOver(event, 'backlog')} onDrop={(event) => handlePanelDrop(event, 'backlog')}>
          {expandedPanels.backlog && backlogItems.map((issue) => (
            <BacklogIssueRow key={`backlog-${issue.id}`} issue={issue} blocked={blockedFor(issue.id)} canEdit={canEditIssue} onMove={handleBacklogMove} onOpen={() => navigate(`/issues/${issue.id}`)} isSelected={selectedIssueIds.includes(issue.id)} onToggleSelect={toggleIssueSelection} onDragStart={handleIssueDragStart} onDragEnd={handleIssueDragEnd} />
          ))}
        </div>
      </article>
      {confirmDialog}
    </section>
  )
}
