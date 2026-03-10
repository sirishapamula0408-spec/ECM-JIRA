import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useIssues } from '../../context/IssueContext'
import { useAppData } from '../../context/AppDataContext'
import { fetchProjects } from '../../api/projectApi'
import { usePermissions } from '../../hooks/usePermissions'
import { FilterChip } from '../../components/filters/FilterChip'
import { GadgetWrapper } from '../../components/dashboard/GadgetWrapper'
import { AddGadgetModal } from '../../components/dashboard/AddGadgetModal'
import { GadgetConfigModal } from '../../components/dashboard/GadgetConfigModal'
import { PieChartGadget } from '../../components/dashboard/gadgets/PieChartGadget'
import { DonutChartGadget } from '../../components/dashboard/gadgets/DonutChartGadget'
import { BarChartGadget } from '../../components/dashboard/gadgets/BarChartGadget'
import { FilterResultsGadget } from '../../components/dashboard/gadgets/FilterResultsGadget'
import { ActivityStreamGadget } from '../../components/dashboard/gadgets/ActivityStreamGadget'
import { SprintHealthGadget } from '../../components/dashboard/gadgets/SprintHealthGadget'
import { useDashboardLayout } from '../../hooks/useDashboardLayout'
import { ISSUE_STATUSES, PRIORITIES, ISSUE_TYPES } from '../../constants'
import './DashboardPage.css'

const GADGET_COMPONENTS = {
  pie: PieChartGadget,
  donut: DonutChartGadget,
  bar: BarChartGadget,
  filterResults: FilterResultsGadget,
  activityStream: ActivityStreamGadget,
  sprintHealth: SprintHealthGadget,
}

export function DashboardPage() {
  const { issues } = useIssues()
  const { activity } = useAppData()
  const { isAdmin } = usePermissions()
  const issueList = Array.isArray(issues) ? issues : []
  const activityList = Array.isArray(activity) ? activity : []

  const {
    title, gadgets, setTitle, addGadget, removeGadget,
    updateGadgetConfig, updateGadgetSize, updateGadgetTitle, reorderGadgets,
  } = useDashboardLayout()

  // Fetch projects for the filter and default to the first project
  const [projectList, setProjectList] = useState([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  useEffect(() => {
    fetchProjects()
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setProjectList(data)
          setFilters((f) => ({ ...f, project: String(data[0].id) }))
        }
        setProjectsLoaded(true)
      })
      .catch(() => { setProjectsLoaded(true) })
  }, [])

  // Build projectId → name lookup
  const projectMap = useMemo(() => {
    const map = {}
    for (const p of projectList) {
      map[p.id] = p.name
    }
    return map
  }, [projectList])

  // Global filters
  const [filters, setFilters] = useState({
    project: 'All',
    issueType: 'All',
    priority: 'All',
    status: 'All',
    assignee: 'All',
    sprint: 'All',
  })

  const setFilter = (key, value) => {
    if (key === 'project') {
      setFilters((f) => ({ ...f, project: value, assignee: 'All', sprint: 'All' }))
      return
    }
    setFilters((f) => ({ ...f, [key]: value }))
  }
  const clearFilter = (key) => setFilters((f) => ({ ...f, [key]: 'All' }))

  // Issues scoped to selected project (for deriving assignees/sprints)
  const projectIssues = issueList.filter((i) => filters.project === 'All' || String(i.projectId) === filters.project)

  // Derive unique values from the selected project's issues
  const assignees = Array.from(new Set(projectIssues.map((i) => i.assignee).filter(Boolean))).sort()
  const sprints = Array.from(new Set(projectIssues.map((i) => i.sprint).filter(Boolean))).sort()

  // Build project filter options from fetched projects
  const projectOptions = projectList.map((p) => ({ value: String(p.id), label: p.name }))

  // Apply global filters
  const filteredIssues = issueList.filter((item) => {
    if (filters.project !== 'All' && String(item.projectId) !== filters.project) return false
    if (filters.issueType !== 'All' && item.issueType !== filters.issueType) return false
    if (filters.priority !== 'All' && item.priority !== filters.priority) return false
    if (filters.status !== 'All' && item.status !== filters.status) return false
    if (filters.assignee !== 'All' && item.assignee !== filters.assignee) return false
    if (filters.sprint !== 'All' && item.sprint !== filters.sprint) return false
    return true
  })

  const filteredActivity = activityList.filter((item) => {
    if (filters.assignee === 'All') return true
    return String(item.actor || '').toLowerCase() === String(filters.assignee || '').toLowerCase()
  })

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [configGadget, setConfigGadget] = useState(null)
  const [maximizedId, setMaximizedId] = useState(null)

  // Dashboard title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)

  const handleTitleSave = () => {
    if (titleDraft.trim()) setTitle(titleDraft.trim())
    setIsEditingTitle(false)
  }

  // Drag and drop
  const dragIndexRef = useRef(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)

  const handleDragStart = useCallback((index) => (e) => {
    dragIndexRef.current = index
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((index) => (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }, [])

  const handleDrop = useCallback((index) => (e) => {
    e.preventDefault()
    const from = dragIndexRef.current
    if (from !== null && from !== index) {
      reorderGadgets(from, index)
    }
    dragIndexRef.current = null
    setDragOverIndex(null)
  }, [reorderGadgets])

  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null
    setDragOverIndex(null)
  }, [])

  // Config save handler
  const handleConfigSave = (id, newTitle, newConfig) => {
    updateGadgetTitle(id, newTitle)
    updateGadgetConfig(id, newConfig)
  }

  // Render gadget content
  const renderGadgetContent = (gadget) => {
    const Component = GADGET_COMPONENTS[gadget.type]
    if (!Component) return <div className="gadget-unknown">Unknown gadget type: {gadget.type}</div>

    const props = { issues: filteredIssues, config: gadget.config }
    if (gadget.type === 'activityStream') {
      props.activity = filteredActivity
    }
    return <Component {...props} />
  }

  const hasActiveFilters = Object.entries(filters).some(([key, v]) => key !== 'project' && v !== 'All')

  return (
    <section className="page dashboard-page">
      {/* Dashboard header */}
      <div className="dashboard-header">
        <div className="dashboard-title-area">
          {isEditingTitle && isAdmin ? (
            <input
              className="dashboard-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); if (e.key === 'Escape') setIsEditingTitle(false) }}
              autoFocus
            />
          ) : (
            <h1 className="dashboard-title" onClick={isAdmin ? () => { setTitleDraft(title); setIsEditingTitle(true) } : undefined}>
              {title}
              {isAdmin && (
                <svg className="dashboard-title-edit" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
                </svg>
              )}
            </h1>
          )}
        </div>
        {isAdmin && (
          <div className="dashboard-actions">
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
              <span className="plus-create-content">
                <span className="plus-create-symbol">+</span> Add Gadget
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Global filter bar */}
      <div className="dashboard-filters">
        <FilterChip
          label="Project"
          value={filters.project}
          options={projectOptions}
          onChange={(v) => setFilter('project', v)}
          onClear={() => {}}
          hideClear
        />
        <FilterChip
          label="Type"
          value={filters.issueType}
          options={['All', ...ISSUE_TYPES.map((t) => ({ value: t, label: t }))]}
          onChange={(v) => setFilter('issueType', v)}
          onClear={() => clearFilter('issueType')}
        />
        <FilterChip
          label="Priority"
          value={filters.priority}
          options={['All', ...PRIORITIES]}
          onChange={(v) => setFilter('priority', v)}
          onClear={() => clearFilter('priority')}
        />
        <FilterChip
          label="Status"
          value={filters.status}
          options={['All', ...ISSUE_STATUSES.map((s) => ({ value: s, label: s }))]}
          onChange={(v) => setFilter('status', v)}
          onClear={() => clearFilter('status')}
        />
        <FilterChip
          label="Assignee"
          value={filters.assignee}
          options={['All', ...assignees]}
          onChange={(v) => setFilter('assignee', v)}
          onClear={() => clearFilter('assignee')}
        />
        <FilterChip
          label="Sprint"
          value={filters.sprint}
          options={['All', ...sprints]}
          onChange={(v) => setFilter('sprint', v)}
          onClear={() => clearFilter('sprint')}
        />
        {hasActiveFilters && (
          <button className="btn btn-ghost dashboard-clear-filters" onClick={() => setFilters((f) => ({ ...f, issueType: 'All', priority: 'All', status: 'All', assignee: 'All', sprint: 'All' }))}>
            Clear all
          </button>
        )}
      </div>

      {/* Gadget grid */}
      {gadgets.length === 0 ? (
        <div className="dashboard-empty">
          <h3>No gadgets yet</h3>
          <p>Click "Add Gadget" to get started with your custom dashboard.</p>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>Add Gadget</button>
        </div>
      ) : (
        <div className="dashboard-grid">
          {gadgets.map((gadget, index) => (
            <GadgetWrapper
              key={gadget.id}
              gadget={gadget}
              onRemove={isAdmin ? () => removeGadget(gadget.id) : undefined}
              onConfig={() => setConfigGadget(gadget)}
              onResize={(size) => updateGadgetSize(gadget.id, size)}
              onDragStart={handleDragStart(index)}
              onDragOver={handleDragOver(index)}
              onDrop={handleDrop(index)}
              onDragEnd={handleDragEnd}
              isDragOver={dragOverIndex === index}
              isMaximized={maximizedId === gadget.id}
              onMaximize={() => setMaximizedId((prev) => (prev === gadget.id ? null : gadget.id))}
            >
              {renderGadgetContent(gadget)}
            </GadgetWrapper>
          ))}
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <AddGadgetModal onAdd={addGadget} onClose={() => setShowAddModal(false)} />
      )}
      {configGadget && (
        <GadgetConfigModal gadget={configGadget} onSave={handleConfigSave} onClose={() => setConfigGadget(null)} />
      )}
    </section>
  )
}
