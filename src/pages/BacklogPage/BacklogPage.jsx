import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useIssues } from '../../context/IssueContext'
import { useSprints } from '../../context/SprintContext'
import { useMembers } from '../../context/MemberContext'
import { usePermissions } from '../../hooks/usePermissions'
import './BacklogPage.css'
import { ISSUE_STATUSES } from '../../constants'
import { TopNavIcon } from '../../components/icons/TopNavIcon'
import { BacklogIssueRow } from '../../components/issues/BacklogIssueRow'

export function BacklogPage() {
  const { issues, handleMove, handleCreate: onCreateIssue } = useIssues()
  const { sprints, handleCreateSprint: onCreateSprint, handleStartSprint: onStartSprint, handleUpdateSprint: onUpdateSprint, handleDeleteSprint: onDeleteSprint } = useSprints()
  const { profile } = useMembers()
  const { projectId } = useParams()
  const { canEditIssue, canCreateIssue, canManageSprints } = usePermissions(projectId)
  const defaultAssignee = profile?.full_name || 'Alex Rivera'
  const navigate = useNavigate()
  const scopedIssues = projectId ? issues.filter((issue) => issue.projectId === Number(projectId)) : issues
  const [expandedPanels, setExpandedPanels] = useState({ backlog: true })
  const [selectedIssueIds, setSelectedIssueIds] = useState([])
  const [bulkStatus, setBulkStatus] = useState('To Do')
  const [searchTerm, setSearchTerm] = useState('')
  const [backlogMessage, setBacklogMessage] = useState('')
  const [dragIssueId, setDragIssueId] = useState(null)
  const [dropPanelId, setDropPanelId] = useState('')
  const [quickCreateBySprint, setQuickCreateBySprint] = useState({})
  const [quickCreateTitleBySprint, setQuickCreateTitleBySprint] = useState({})
  const [quickCreateBusyBySprint, setQuickCreateBusyBySprint] = useState({})
  const [quickCreateErrorBySprint, setQuickCreateErrorBySprint] = useState({})
  const [openSprintMenuId, setOpenSprintMenuId] = useState(null)

  const normalizedSearch = searchTerm.trim().toLowerCase()
  const allBacklogItems = scopedIssues.filter((issue) => issue.status === 'Backlog')
  const allSprintItems = scopedIssues.filter((issue) => issue.status !== 'Backlog')
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

  async function applyBulkStatus() {
    if (selectedIssueIds.length === 0) return
    await Promise.all(selectedIssueIds.map((id) => handleMove(id, bulkStatus, bulkStatus === 'Backlog' ? null : defaultSprintId)))
    if (bulkStatus === 'Backlog') setPanelExpanded('backlog', true)
    else setPanelExpanded(defaultSprintId, true)
    setSelectedIssueIds([])
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

  async function handleStartSprintAction(sprintId) { await onStartSprint(sprintId); setPanelExpanded(sprintId, true) }

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
    const confirmed = window.confirm(`Delete ${sprintPanel.name}? Issues will be moved to backlog.`)
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
        </div>
        <div className="backlog-toolbar-right">
          <div className="backlog-bulk">
            <span className="bulk-count">{selectedCount} selected</span>
            <select className="bulk-status-select" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} disabled={selectedCount === 0 || !canEditIssue}>
              {ISSUE_STATUSES.map((status) => (<option key={status} value={status}>{status.toUpperCase()}</option>))}
            </select>
            <button className="btn btn-ghost" type="button" onClick={applyBulkStatus} disabled={selectedCount === 0 || !canEditIssue}>Apply</button>
          </div>
          <button className="icon-btn" type="button" aria-label="Views">chart</button>
          <button className="icon-btn" type="button" aria-label="Display settings">settings</button>
          <button className="icon-btn" type="button" aria-label="More">...</button>
        </div>
      </div>
      {backlogMessage && <p className="backlog-message">{backlogMessage}</p>}

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
                  <input className="backlog-checkbox" type="checkbox" checked={sprintPanel.issueIds.length > 0 && sprintPanel.issueIds.every((id) => selectedIssueIds.includes(id))} onChange={(event) => toggleSectionSelection(sprintPanel.issueIds, event.target.checked)} aria-label={`Select all ${sprintPanel.name} issues`} />
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
                      <BacklogIssueRow key={`${sprintPanel.id}-${issue.id}`} issue={issue} onMove={canEditIssue ? (id, status) => handleBacklogMove(id, status, sprintPanel.id) : undefined} onOpen={() => navigate(`/issues/${issue.id}`)} isSelected={selectedIssueIds.includes(issue.id)} onToggleSelect={toggleIssueSelection} onDragStart={canEditIssue ? handleIssueDragStart : undefined} onDragEnd={canEditIssue ? handleIssueDragEnd : undefined} />
                    ))}
                    {quickCreateBySprint[sprintPanel.id] && (
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
            <input className="backlog-checkbox" type="checkbox" checked={backlogIds.length > 0 && backlogIds.every((id) => selectedIssueIds.includes(id))} onChange={(event) => toggleSectionSelection(backlogIds, event.target.checked)} aria-label="Select all backlog issues" />
            <button className={`sprint-toggle${expandedPanels.backlog ? ' expanded' : ''}`} type="button" aria-label={expandedPanels.backlog ? 'Collapse backlog' : 'Expand backlog'} onClick={() => setPanelExpanded('backlog', !expandedPanels.backlog)}>
              <span className="sprint-caret" aria-hidden="true" />
            </button>
            <div className="jira-sprint-title"><strong>Backlog</strong><span>({backlogItems.length} work items)</span></div>
          </div>
          <div className="jira-sprint-metrics">
            <span className="metric-pill">0</span>
            <span className="metric-pill metric-pill-blue">0</span>
            <span className="metric-pill metric-pill-green">0</span>
            {canManageSprints && <button className="btn btn-ghost sprint-action-btn" type="button" onClick={createSprintFromSelection}>Create sprint</button>}
          </div>
        </div>

        <div className={`sprint-issues${expandedPanels.backlog ? ' expanded' : ''}${dropPanelId === 'backlog' ? ' drop-target-active' : ''}`} onDragOver={(event) => handlePanelDragOver(event, 'backlog')} onDrop={(event) => handlePanelDrop(event, 'backlog')}>
          {expandedPanels.backlog && backlogItems.map((issue) => (
            <BacklogIssueRow key={`backlog-${issue.id}`} issue={issue} onMove={canEditIssue ? handleBacklogMove : undefined} onOpen={() => navigate(`/issues/${issue.id}`)} isSelected={selectedIssueIds.includes(issue.id)} onToggleSelect={toggleIssueSelection} onDragStart={canEditIssue ? handleIssueDragStart : undefined} onDragEnd={canEditIssue ? handleIssueDragEnd : undefined} />
          ))}
        </div>
      </article>
    </section>
  )
}
