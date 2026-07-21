import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import { ISSUE_STATUSES } from '../../constants'
import { fetchProjects } from '../../api/projectApi'
import { fetchProjectStatuses, createStatus, deleteStatus } from '../../api/issueConfigApi'
import {
  fetchWorkflowTransitions,
  createWorkflowTransition,
  updateWorkflowTransition,
  deleteWorkflowTransition,
} from '../../api/workflowTransitionApi'
import { usePermissions } from '../../hooks/usePermissions'
import { useConfirm } from '../../components/common/ConfirmDialog'
import './WorkflowEditorPage.css'

const NODE_WIDTH = 180
const NODE_HEIGHT = 60
const NUDGE_STEP = 10

// Backend status categories are 'todo' | 'inprogress' | 'done'. Older demo data
// used 'in-progress'; normalize so both render.
function normalizeCategory(cat) {
  const c = String(cat || 'todo').toLowerCase()
  if (c === 'in-progress' || c === 'in progress') return 'inprogress'
  if (c === 'todo' || c === 'inprogress' || c === 'done') return c
  return 'todo'
}

const CATEGORY_STYLES = {
  'todo':       { bg: '#DEEBFF', color: '#0052CC', border: '#4C9AFF', label: 'To Do' },
  'inprogress': { bg: '#FFF0B3', color: '#FF8B00', border: '#FFE380', label: 'In Progress' },
  'done':       { bg: '#E3FCEF', color: '#006644', border: '#79F2C0', label: 'Done' },
}

function categoryStyle(cat) {
  return CATEGORY_STYLES[normalizeCategory(cat)] || CATEGORY_STYLES.todo
}

// Auto-layout position for a status that has no saved coordinate yet.
function autoPos(i) {
  return { x: 60 + (i % 5) * 260, y: 70 + Math.floor(i / 5) * 170 }
}

function positionsKey(projectId) {
  return `wfEditor:positions:${projectId}`
}

function readPositions(projectId) {
  if (!projectId) return {}
  try {
    return JSON.parse(localStorage.getItem(positionsKey(projectId)) || '{}') || {}
  } catch {
    return {}
  }
}

function statusNamesOf(list) {
  return (list || [])
    .map((s) => (typeof s === 'string' ? s : s?.name))
    .filter(Boolean)
}

export function WorkflowEditorPage() {
  // JL-269: workflow config (statuses/transitions) is workspace-Admin only.
  const { isAdmin } = usePermissions()
  const { confirm, confirmDialog } = useConfirm()

  // ── Shared, project-scoped state (drives BOTH the canvas and the Rules panel) ──
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [statuses, setStatuses] = useState([])
  const [transitions, setTransitions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Node positions persisted to localStorage, keyed by status name.
  const [positions, setPositions] = useState({})

  const [selectedNodeName, setSelectedNodeName] = useState(null)
  const [selectedTransId, setSelectedTransId] = useState(null)
  const [zoom, setZoom] = useState(1)

  // Add status modal
  const [showAddStatus, setShowAddStatus] = useState(false)
  const [newStatusName, setNewStatusName] = useState('')
  const [newStatusCategory, setNewStatusCategory] = useState('todo')
  const [newStatusColor, setNewStatusColor] = useState('#42526E')
  const [modalBusy, setModalBusy] = useState(false)
  const [modalError, setModalError] = useState('')

  // Add transition modal
  const [showAddTransition, setShowAddTransition] = useState(false)
  const [newTransFrom, setNewTransFrom] = useState('')
  const [newTransTo, setNewTransTo] = useState('')

  const dragging = useRef(null)
  const didDrag = useRef(false)
  const canvasWrapperRef = useRef(null)
  const persistTimer = useRef(null)
  const addStatusBtnRef = useRef(null)
  const addTransBtnRef = useRef(null)

  // ── Load project list on mount, default to first ──
  useEffect(() => {
    fetchProjects()
      .then((list) => {
        setProjects(list || [])
        if (list && list.length > 0) setProjectId(String(list[0].id))
      })
      .catch(() => setProjects([]))
  }, [])

  // ── Load statuses + transitions for the selected project (single source) ──
  const reload = useCallback((pid) => {
    const id = pid ?? projectId
    if (!id) {
      setStatuses([])
      setTransitions([])
      return Promise.resolve()
    }
    setLoading(true)
    setError('')
    return Promise.all([
      fetchProjectStatuses(id).catch((e) => { throw e }),
      fetchWorkflowTransitions(id).catch((e) => { throw e }),
    ])
      .then(([sts, trs]) => {
        setStatuses(sts || [])
        setTransitions(trs || [])
      })
      .catch((e) => setError(e?.message || 'Failed to load workflow'))
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    setPositions(readPositions(projectId))
    setSelectedNodeName(null)
    setSelectedTransId(null)
    reload(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const statusNames = useMemo(() => statusNamesOf(statuses), [statuses])

  // ── Derived nodes: statuses positioned by saved coords or auto-layout ──
  const nodes = useMemo(() => statuses.map((s, i) => {
    const name = typeof s === 'string' ? s : s?.name
    const p = positions[name] || autoPos(i)
    return {
      name,
      id: (s && typeof s === 'object' ? s.id : null) ?? null,
      category: normalizeCategory(s && typeof s === 'object' ? s.category : 'todo'),
      color: (s && typeof s === 'object' ? s.color : null) || null,
      projectId: (s && typeof s === 'object' ? s.project_id : null) ?? null,
      x: p.x,
      y: p.y,
    }
  }), [statuses, positions])

  const nodeByName = useCallback((name) => nodes.find((n) => n.name === name), [nodes])

  function getNodeCenter(name) {
    const node = nodeByName(name)
    if (!node) return null
    return { x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT / 2 }
  }

  // ── Persist positions (debounced) ──
  const persistPositions = useCallback((map) => {
    if (!projectId) return
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(positionsKey(projectId), JSON.stringify(map))
      } catch { /* ignore quota errors */ }
    }, 250)
  }, [projectId])

  // ── Convert mouse event to canvas coordinates ──
  function toCanvasCoords(e) {
    const wrapper = canvasWrapperRef.current
    if (!wrapper) return { x: 0, y: 0 }
    const rect = wrapper.getBoundingClientRect()
    const x = (e.clientX - rect.left + wrapper.scrollLeft) / zoom
    const y = (e.clientY - rect.top + wrapper.scrollTop) / zoom
    return { x, y }
  }

  // ── Drag handlers ──
  const handleNodeMouseDown = useCallback((e, name) => {
    if (!isAdmin) return
    e.stopPropagation()
    e.preventDefault()
    const node = nodeByName(name)
    if (!node) return
    const pos = toCanvasCoords(e)
    dragging.current = { name, offsetX: pos.x - node.x, offsetY: pos.y - node.y }
    didDrag.current = false
    setSelectedNodeName(name)
    setSelectedTransId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeByName, zoom, isAdmin])

  const handleCanvasMouseMove = useCallback((e) => {
    if (!dragging.current) return
    didDrag.current = true
    const pos = toCanvasCoords(e)
    const x = Math.max(0, pos.x - dragging.current.offsetX)
    const y = Math.max(0, pos.y - dragging.current.offsetY)
    setPositions((prev) => ({ ...prev, [dragging.current.name]: { x, y } }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  const handleCanvasMouseUp = useCallback(() => {
    if (dragging.current) {
      dragging.current = null
      setPositions((prev) => { persistPositions(prev); return prev })
    }
  }, [persistPositions])

  const handleCanvasClick = useCallback(() => {
    if (didDrag.current) { didDrag.current = false; return }
    setSelectedNodeName(null)
    setSelectedTransId(null)
  }, [])

  const handleTransitionClick = useCallback((e, transId) => {
    e.stopPropagation()
    setSelectedTransId(transId)
    setSelectedNodeName(null)
  }, [])

  // ── Zoom ──
  const handleZoomIn = () => setZoom((z) => Math.min(2.0, +(z + 0.1).toFixed(1)))
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))

  // ── Reset layout (JL-268: replaces the dead "Publish" / "Discard" buttons) ──
  const handleResetLayout = () => {
    if (projectId) {
      try { localStorage.removeItem(positionsKey(projectId)) } catch { /* ignore */ }
    }
    setPositions({})
    setSelectedNodeName(null)
    setSelectedTransId(null)
    setZoom(1)
  }

  // ── Add status ──
  const openAddStatus = () => {
    setNewStatusName('')
    setNewStatusCategory('todo')
    setNewStatusColor('#42526E')
    setModalError('')
    setShowAddStatus(true)
  }

  const handleAddStatus = async () => {
    const name = newStatusName.trim()
    if (!name || !projectId) return
    setModalBusy(true)
    setModalError('')
    try {
      await createStatus(projectId, {
        name,
        color: newStatusColor,
        category: newStatusCategory,
        position: statuses.length,
      })
      setShowAddStatus(false)
      await reload(projectId)
    } catch (e) {
      setModalError(e?.message || 'Failed to add status')
    } finally {
      setModalBusy(false)
    }
  }

  // ── Add transition ──
  const openAddTransition = () => {
    setNewTransFrom('')
    setNewTransTo('')
    setModalError('')
    setShowAddTransition(true)
  }

  const handleAddTransition = async () => {
    if (!projectId || !newTransFrom || !newTransTo || newTransFrom === newTransTo) return
    setModalBusy(true)
    setModalError('')
    try {
      await createWorkflowTransition(projectId, { fromStatus: newTransFrom, toStatus: newTransTo })
      setShowAddTransition(false)
      await reload(projectId)
    } catch (e) {
      setModalError(e?.message || 'Failed to add transition')
    } finally {
      setModalBusy(false)
    }
  }

  // ── Delete node (status) ──
  const requestDeleteNode = useCallback(async (node) => {
    if (!node || node.id == null) return
    const isGlobal = node.projectId == null
    const message = isGlobal
      ? `"${node.name}" is a built-in/global status shared across projects. Deleting it may affect other projects and any issues currently in this status. Continue?`
      : `Delete the status "${node.name}"? Any issues currently in this status may be affected.`
    const ok = await confirm({
      title: 'Delete status?',
      message,
      danger: true,
      confirmLabel: 'Delete status',
    })
    if (!ok) return
    try {
      await deleteStatus(node.id)
      setSelectedNodeName(null)
      await reload(projectId)
    } catch (e) {
      setError(e?.message || 'Failed to delete status')
    }
  }, [confirm, reload, projectId])

  // ── Delete transition (arrow) ──
  const requestDeleteTransition = useCallback(async (trans) => {
    if (!trans) return
    const ok = await confirm({
      title: 'Delete transition?',
      message: `Delete the transition ${trans.fromStatus} → ${trans.toStatus}? Its validators and post-functions will be removed.`,
      danger: true,
      confirmLabel: 'Delete transition',
    })
    if (!ok) return
    try {
      await deleteWorkflowTransition(trans.id)
      setSelectedTransId(null)
      await reload(projectId)
    } catch (e) {
      setError(e?.message || 'Failed to delete transition')
    }
  }, [confirm, reload, projectId])

  // ── Keyboard interaction on nodes (JL-273) ──
  const handleNodeKeyDown = useCallback((e, node) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setSelectedNodeName(node.name)
      setSelectedTransId(null)
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && isAdmin) {
      e.preventDefault()
      requestDeleteNode(node)
      return
    }
    const nudges = {
      ArrowUp: { dx: 0, dy: -NUDGE_STEP },
      ArrowDown: { dx: 0, dy: NUDGE_STEP },
      ArrowLeft: { dx: -NUDGE_STEP, dy: 0 },
      ArrowRight: { dx: NUDGE_STEP, dy: 0 },
    }
    if (nudges[e.key] && isAdmin) {
      e.preventDefault()
      const { dx, dy } = nudges[e.key]
      setSelectedNodeName(node.name)
      setPositions((prev) => {
        const cur = prev[node.name] || { x: node.x, y: node.y }
        const next = { ...prev, [node.name]: { x: Math.max(0, cur.x + dx), y: Math.max(0, cur.y + dy) } }
        persistPositions(next)
        return next
      })
    }
  }, [isAdmin, requestDeleteNode, persistPositions])

  // ── Helpers ──
  const selectedNode = nodeByName(selectedNodeName)
  const selectedTrans = transitions.find((t) => t.id === selectedTransId)

  const canAddTransition = statusNames.length >= 2

  return (
    <section className="workflow-editor-page">
      {/* Header */}
      <div className="wfe-header">
        <div className="wfe-header-left">
          <h2>Workflow Editor</h2>
          <label className="wfe-project-select-label">
            <span className="visually-hidden">Project</span>
            <select
              className="wfe-project-select"
              aria-label="Project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Select project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name || p.key || `Project ${p.id}`}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="wfe-header-actions">
          <button type="button" className="btn btn-ghost" onClick={handleResetLayout}>
            Reset layout
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="wfe-toolbar">
        <div className="wfe-toolbar-left">
          {isAdmin ? (
            <>
              <button
                ref={addStatusBtnRef}
                type="button"
                className="wfe-toolbar-btn"
                onClick={openAddStatus}
                disabled={!projectId}
                aria-label="Add status"
              >
                <span aria-hidden="true">+</span> Add status
              </button>
              <button
                ref={addTransBtnRef}
                type="button"
                className="wfe-toolbar-btn"
                onClick={openAddTransition}
                disabled={!projectId || !canAddTransition}
                aria-label="Add transition"
              >
                <span aria-hidden="true">→</span> Add transition
              </button>
            </>
          ) : (
            <span className="wfe-readonly-hint muted">Workspace Admins can configure the workflow.</span>
          )}
        </div>
        <div className="wfe-toolbar-right">
          <button type="button" className="wfe-zoom-btn" onClick={handleZoomIn} aria-label="Zoom in">+</button>
          <span className="wfe-zoom-label">{Math.round(zoom * 100)}%</span>
          <button type="button" className="wfe-zoom-btn" onClick={handleZoomOut} aria-label="Zoom out">−</button>
        </div>
      </div>

      {/* Body */}
      <div className="wfe-body">
        {/* Canvas */}
        <div
          ref={canvasWrapperRef}
          className="wfe-canvas-wrapper"
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onClick={handleCanvasClick}
        >
          {loading ? (
            <div className="wfe-canvas-status muted">Loading workflow…</div>
          ) : error ? (
            <div className="wfe-canvas-status wfe-canvas-error">{error}</div>
          ) : !projectId ? (
            <div className="wfe-canvas-status muted">Select a project to view its workflow.</div>
          ) : nodes.length === 0 ? (
            <div className="wfe-canvas-status muted">This project has no statuses yet.</div>
          ) : (
            <div className="wfe-canvas" style={{ transform: `scale(${zoom})` }}>
              {/* SVG arrow layer */}
              <svg className="wfe-arrows-layer">
                <defs>
                  <marker id="wfe-arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#6b778c" />
                  </marker>
                  <marker id="wfe-arrowhead-sel" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#0052cc" />
                  </marker>
                </defs>
                {transitions.map((t) => {
                  const from = getNodeCenter(t.fromStatus)
                  const to = getNodeCenter(t.toStatus)
                  if (!from || !to) return null
                  const isSelected = selectedTransId === t.id

                  const pairKey = [t.fromStatus, t.toStatus].sort().join('|')
                  const siblings = transitions.filter((s) => [s.fromStatus, s.toStatus].sort().join('|') === pairKey)
                  const sibIndex = siblings.indexOf(t)
                  const sibCount = siblings.length
                  const offsetAmount = sibCount > 1 ? (sibIndex - (sibCount - 1) / 2) * 16 : 0

                  const dx = to.x - from.x
                  const dy = to.y - from.y
                  const dist = Math.sqrt(dx * dx + dy * dy) || 1
                  const ux = dx / dist
                  const uy = dy / dist
                  const px = -uy * offsetAmount
                  const py = ux * offsetAmount
                  const startX = from.x + ux * (NODE_WIDTH / 2) + px
                  const startY = from.y + uy * (NODE_HEIGHT / 2) + py
                  const endX = to.x - ux * (NODE_WIDTH / 2 + 12) + px
                  const endY = to.y - uy * (NODE_HEIGHT / 2 + 12) + py

                  return (
                    <g
                      key={t.id}
                      className={`wfe-arrow${isSelected ? ' wfe-arrow--selected' : ''}`}
                      onClick={(e) => handleTransitionClick(e, t.id)}
                    >
                      <line className="wfe-arrow-hitarea" x1={startX} y1={startY} x2={endX} y2={endY} />
                      <line
                        className="wfe-arrow-line"
                        x1={startX} y1={startY} x2={endX} y2={endY}
                        stroke={isSelected ? '#0052cc' : '#6b778c'}
                        strokeWidth={isSelected ? 3 : 2}
                        markerEnd={isSelected ? 'url(#wfe-arrowhead-sel)' : 'url(#wfe-arrowhead)'}
                      />
                      <text
                        className="wfe-arrow-label"
                        x={(startX + endX) / 2}
                        y={(startY + endY) / 2 - 8}
                        textAnchor="middle"
                      >
                        {t.fromStatus} → {t.toStatus}
                      </text>
                    </g>
                  )
                })}
              </svg>

              {/* Nodes */}
              {nodes.map((node) => {
                const style = categoryStyle(node.category)
                const selected = selectedNodeName === node.name
                return (
                  <div
                    key={node.name}
                    className={`wfe-node${selected ? ' wfe-node--selected' : ''}`}
                    style={{
                      left: node.x,
                      top: node.y,
                      backgroundColor: node.color || style.bg,
                      borderColor: style.border,
                      color: node.color ? undefined : style.color,
                    }}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={`Status ${node.name}, category ${style.label}`}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.name)}
                    onClick={(e) => { e.stopPropagation(); setSelectedNodeName(node.name); setSelectedTransId(null) }}
                    onKeyDown={(e) => handleNodeKeyDown(e, node)}
                  >
                    <div>
                      <div className="wfe-node-name">{node.name}</div>
                      <div className="wfe-node-category">{node.category}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Properties Panel */}
        <div className="wfe-properties">
          {selectedNode ? (
            <StatusProperties
              node={selectedNode}
              transitions={transitions}
              isAdmin={isAdmin}
              onDelete={() => requestDeleteNode(selectedNode)}
            />
          ) : selectedTrans ? (
            <TransitionProperties
              key={selectedTrans.id}
              trans={selectedTrans}
              isAdmin={isAdmin}
              onSaved={() => reload(projectId)}
              onDelete={() => requestDeleteTransition(selectedTrans)}
            />
          ) : (
            <div className="wfe-empty-props">
              <p>Properties</p>
              <p>Select a status or transition to view its properties.</p>
              {transitions.length > 0 && (
                <div className="wfe-prop-group" style={{ marginTop: 16 }}>
                  <span className="wfe-prop-label">Transitions</span>
                  <ul className="wfe-trans-select-list">
                    {transitions.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="wfe-trans-select-btn"
                          onClick={() => { setSelectedTransId(t.id); setSelectedNodeName(null) }}
                        >
                          {t.fromStatus} → {t.toStatus}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* JL-79: Configurable workflow transition rules (persisted per project) */}
      <WorkflowRulesPanel
        isAdmin={isAdmin}
        projectId={projectId}
        statuses={statusNames}
        transitions={transitions}
        loading={loading}
        error={error}
        onChanged={() => reload(projectId)}
      />

      {/* Add Status Modal (JL-273: MUI Dialog → role=dialog, aria-modal, focus trap, Esc) */}
      <Dialog
        open={showAddStatus}
        onClose={() => !modalBusy && setShowAddStatus(false)}
        aria-labelledby="wfe-add-status-title"
        maxWidth="xs"
        fullWidth
        TransitionProps={{ onExited: () => addStatusBtnRef.current?.focus() }}
      >
        <DialogTitle id="wfe-add-status-title">Add Status</DialogTitle>
        <DialogContent>
          <div className="wfe-modal-form">
            {modalError && <div className="alert alert-error" style={{ color: '#bf2600' }}>{modalError}</div>}
            <div className="wfe-modal-row">
              <label htmlFor="wfe-new-status-name">Status name</label>
              <input
                id="wfe-new-status-name"
                type="text"
                value={newStatusName}
                onChange={(e) => setNewStatusName(e.target.value)}
                placeholder="e.g. QA Testing"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddStatus() }}
              />
            </div>
            <div className="wfe-modal-row">
              <label htmlFor="wfe-new-status-cat">Category</label>
              <select id="wfe-new-status-cat" value={newStatusCategory} onChange={(e) => setNewStatusCategory(e.target.value)}>
                <option value="todo">To Do</option>
                <option value="inprogress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div className="wfe-modal-row">
              <label htmlFor="wfe-new-status-color">Color</label>
              <input
                id="wfe-new-status-color"
                type="color"
                value={newStatusColor}
                onChange={(e) => setNewStatusColor(e.target.value)}
              />
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddStatus(false)} disabled={modalBusy} color="inherit">Cancel</Button>
          <Button onClick={handleAddStatus} disabled={!newStatusName.trim() || modalBusy} variant="contained">
            {modalBusy ? 'Adding…' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Transition Modal */}
      <Dialog
        open={showAddTransition}
        onClose={() => !modalBusy && setShowAddTransition(false)}
        aria-labelledby="wfe-add-trans-title"
        maxWidth="xs"
        fullWidth
        TransitionProps={{ onExited: () => addTransBtnRef.current?.focus() }}
      >
        <DialogTitle id="wfe-add-trans-title">Add Transition</DialogTitle>
        <DialogContent>
          <div className="wfe-modal-form">
            {modalError && <div className="alert alert-error" style={{ color: '#bf2600' }}>{modalError}</div>}
            <div className="wfe-modal-row">
              <label htmlFor="wfe-new-trans-from">From status</label>
              <select id="wfe-new-trans-from" value={newTransFrom} onChange={(e) => setNewTransFrom(e.target.value)}>
                <option value="">Select status…</option>
                {statusNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="wfe-modal-row">
              <label htmlFor="wfe-new-trans-to">To status</label>
              <select id="wfe-new-trans-to" value={newTransTo} onChange={(e) => setNewTransTo(e.target.value)}>
                <option value="">Select status…</option>
                {statusNames.filter((n) => n !== newTransFrom).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddTransition(false)} disabled={modalBusy} color="inherit">Cancel</Button>
          <Button
            onClick={handleAddTransition}
            disabled={!newTransFrom || !newTransTo || newTransFrom === newTransTo || modalBusy}
            variant="contained"
          >
            {modalBusy ? 'Adding…' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      {confirmDialog}
    </section>
  )
}

// ── Status properties (read-only summary + delete) ──
function StatusProperties({ node, transitions, isAdmin, onDelete }) {
  const style = categoryStyle(node.category)
  const from = transitions.filter((t) => t.fromStatus === node.name)
  const to = transitions.filter((t) => t.toStatus === node.name)
  return (
    <>
      <h3 className="wfe-properties-title">Status Properties</h3>
      <div className="wfe-prop-group">
        <span className="wfe-prop-label">Name</span>
        <span className="wfe-prop-value">{node.name}</span>
      </div>
      <div className="wfe-prop-group">
        <span className="wfe-prop-label">Category</span>
        <span className="wfe-category-badge" style={{ backgroundColor: style.bg, color: style.color }}>
          {style.label}
        </span>
      </div>
      <div className="wfe-prop-group">
        <span className="wfe-prop-label">Transitions from</span>
        {from.length === 0 ? <span className="muted">None</span> : from.map((t) => (
          <div key={t.id} className="wfe-transition-item">→ {t.toStatus}</div>
        ))}
      </div>
      <div className="wfe-prop-group">
        <span className="wfe-prop-label">Transitions to</span>
        {to.length === 0 ? <span className="muted">None</span> : to.map((t) => (
          <div key={t.id} className="wfe-transition-item">← {t.fromStatus}</div>
        ))}
      </div>
      {isAdmin && node.id != null && (
        <button type="button" className="wfe-delete-btn" onClick={onDelete}>
          ✕ Delete status
        </button>
      )}
    </>
  )
}

// ── Transition properties (edit validators / post-functions via PATCH) ──
function TransitionProperties({ trans, isAdmin, onSaved, onDelete }) {
  const [requiredField, setRequiredField] = useState('')
  const [setField, setSetField] = useState('')
  const [setValue, setSetValue] = useState('')
  const [commentText, setCommentText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const req = (trans.validators || []).find((v) => v.type === 'required_field')
    setRequiredField(req?.field || '')
    const sf = (trans.postFunctions || []).find((f) => f.type === 'set_field')
    setSetField(sf?.field || '')
    setSetValue(sf?.value || '')
    const cm = (trans.postFunctions || []).find((f) => f.type === 'add_comment')
    setCommentText(cm?.text || '')
  }, [trans])

  const handleSave = async () => {
    setBusy(true)
    setErr('')
    const validators = requiredField ? [{ type: 'required_field', field: requiredField }] : []
    const postFunctions = []
    if (setField) postFunctions.push({ type: 'set_field', field: setField, value: setValue })
    if (commentText.trim()) postFunctions.push({ type: 'add_comment', text: commentText.trim() })
    try {
      await updateWorkflowTransition(trans.id, { validators, postFunctions })
      onSaved?.()
    } catch (e) {
      setErr(e?.message || 'Failed to save transition')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h3 className="wfe-properties-title">Transition Properties</h3>
      <div className="wfe-prop-group">
        <span className="wfe-prop-label">From → To</span>
        <span className="wfe-prop-value">{trans.fromStatus} → {trans.toStatus}</span>
      </div>
      {err && <div className="alert alert-error" style={{ color: '#bf2600', marginBottom: 8 }}>{err}</div>}
      {isAdmin ? (
        <>
          <label className="wfe-prop-field">Require field before transition
            <select value={requiredField} onChange={(e) => setRequiredField(e.target.value)}>
              <option value="">None</option>
              <option value="assignee">assignee</option>
              <option value="resolution">resolution</option>
              <option value="priority">priority</option>
            </select>
          </label>
          <label className="wfe-prop-field">Post-function — set field
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={setField} onChange={(e) => setSetField(e.target.value)}>
                <option value="">None</option>
                <option value="assignee">assignee</option>
                <option value="resolution">resolution</option>
                <option value="priority">priority</option>
              </select>
              <input type="text" value={setValue} onChange={(e) => setSetValue(e.target.value)} placeholder="value" disabled={!setField} />
            </div>
          </label>
          <label className="wfe-prop-field">Post-function — add comment
            <input type="text" value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Comment text" />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
          <button type="button" className="wfe-delete-btn" style={{ marginTop: 12 }} onClick={onDelete}>
            ✕ Delete transition
          </button>
        </>
      ) : (
        <>
          <div className="wfe-prop-group">
            <span className="wfe-prop-label">Validators</span>
            {(trans.validators || []).length === 0 ? <span className="muted">—</span> : (trans.validators || []).map((v, i) => (
              <div key={i} className="wfe-transition-item">required: {v.field}</div>
            ))}
          </div>
          <div className="wfe-prop-group">
            <span className="wfe-prop-label">Post-functions</span>
            {(trans.postFunctions || []).length === 0 ? <span className="muted">—</span> : (trans.postFunctions || []).map((f, i) => (
              <div key={i} className="wfe-transition-item">
                {f.type === 'set_field' ? `set ${f.field}=${f.value}` : `comment: ${f.text}`}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

// JL-79: Panel to list/add/remove configurable workflow transitions for a project.
// Backend enforces these on issue status changes (deny -> 409, validator -> 400,
// allow -> apply post-functions). No transitions configured = all changes allowed.
// JL-274: project selection + data are now lifted to the parent WorkflowEditorPage
// so the canvas and this panel always reflect the same statuses/transitions.
function WorkflowRulesPanel({ isAdmin, projectId, statuses, transitions, loading, error, onChanged }) {
  const statusOptions = statuses && statuses.length > 0 ? statuses : ISSUE_STATUSES

  // Shared add/edit form state. editingId === null means "add" mode.
  const [editingId, setEditingId] = useState(null)
  const [fromStatus, setFromStatus] = useState('')
  const [toStatus, setToStatus] = useState('')
  const [requiredField, setRequiredField] = useState('')
  const [setField, setSetField] = useState('')
  const [setValue, setSetValue] = useState('')
  const [commentText, setCommentText] = useState('')
  const [formError, setFormError] = useState('')

  const resetForm = useCallback(() => {
    setEditingId(null)
    setFromStatus(''); setToStatus(''); setRequiredField('')
    setSetField(''); setSetValue(''); setCommentText('')
  }, [])

  // Cancel edit if the project changes underneath us.
  useEffect(() => { resetForm() }, [projectId, resetForm])

  const buildBody = () => {
    const validators = requiredField ? [{ type: 'required_field', field: requiredField }] : []
    const postFunctions = []
    if (setField) postFunctions.push({ type: 'set_field', field: setField, value: setValue })
    if (commentText.trim()) postFunctions.push({ type: 'add_comment', text: commentText.trim() })
    return { validators, postFunctions }
  }

  const handleAdd = async () => {
    setFormError('')
    if (!projectId || !fromStatus || !toStatus || fromStatus === toStatus) return
    try {
      await createWorkflowTransition(projectId, { fromStatus, toStatus, ...buildBody() })
      resetForm()
      onChanged?.()
    } catch (e) {
      setFormError(e.message || 'Failed to add transition')
    }
  }

  // JL-270: begin editing a rule — prefill the same controls; From/To are immutable.
  const startEdit = (t) => {
    setFormError('')
    setEditingId(t.id)
    setFromStatus(t.fromStatus)
    setToStatus(t.toStatus)
    const req = (t.validators || []).find((v) => v.type === 'required_field')
    setRequiredField(req?.field || '')
    const sf = (t.postFunctions || []).find((f) => f.type === 'set_field')
    setSetField(sf?.field || '')
    setSetValue(sf?.value || '')
    const cm = (t.postFunctions || []).find((f) => f.type === 'add_comment')
    setCommentText(cm?.text || '')
  }

  // JL-270: save edits via PATCH (only validators/post-functions are mutable).
  const handleUpdate = async () => {
    setFormError('')
    if (!editingId) return
    try {
      await updateWorkflowTransition(editingId, buildBody())
      resetForm()
      onChanged?.()
    } catch (e) {
      setFormError(e.message || 'Failed to update transition')
    }
  }

  const handleDelete = async (id) => {
    setFormError('')
    try {
      await deleteWorkflowTransition(id)
      if (editingId === id) resetForm()
      onChanged?.()
    } catch (e) {
      setFormError(e.message || 'Failed to delete transition')
    }
  }

  const isEditing = editingId !== null

  return (
    <div className="wfe-rules-panel" style={{ padding: '16px 24px', borderTop: '1px solid var(--border, #dfe1e6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Transition Rules</h3>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        When no transitions are configured for a project, all status changes are allowed.
      </p>
      {!isAdmin && (
        <p className="wfe-rules-readonly-hint muted" style={{ marginTop: 0 }}>
          Workspace Admins can configure transition rules.
        </p>
      )}

      {(formError || error) && <div className="alert alert-error" style={{ color: '#bf2600', marginBottom: 8 }}>{formError || error}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : transitions.length === 0 ? (
        <p className="muted">No transition rules yet — all status changes are currently allowed. Add a transition to start restricting.</p>
      ) : (
        <table className="wfe-rules-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: 6 }}>From</th>
              <th style={{ padding: 6 }}>To</th>
              <th style={{ padding: 6 }}>Validators</th>
              <th style={{ padding: 6 }}>Post-functions</th>
              {isAdmin && <th style={{ padding: 6 }}></th>}
            </tr>
          </thead>
          <tbody>
            {transitions.map((t) => (
              <tr key={t.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 6 }}>{t.fromStatus}</td>
                <td style={{ padding: 6 }}>{t.toStatus}</td>
                <td style={{ padding: 6 }}>
                  {(t.validators || []).map((v, i) => (
                    <span key={i} className="chip">required: {v.field}</span>
                  ))}
                  {(!t.validators || t.validators.length === 0) && <span className="muted">—</span>}
                </td>
                <td style={{ padding: 6 }}>
                  {(t.postFunctions || []).map((f, i) => (
                    <span key={i} className="chip">
                      {f.type === 'set_field' ? `set ${f.field}=${f.value}` : `comment: ${f.text}`}
                    </span>
                  ))}
                  {(!t.postFunctions || t.postFunctions.length === 0) && <span className="muted">—</span>}
                </td>
                {isAdmin && (
                  <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn btn-ghost" onClick={() => startEdit(t)}>Edit</button>
                    <button type="button" className="btn btn-ghost" onClick={() => handleDelete(t.id)}>Remove</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isAdmin && projectId && (
        <div className="wfe-rules-add" style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
          <strong>{isEditing ? 'Edit transition' : 'Add transition'}</strong>
          {isEditing ? (
            // JL-270: From/To are immutable — show read-only.
            <div className="wfe-rules-fromto" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="chip">{fromStatus}</span>
              <span aria-hidden="true">→</span>
              <span className="chip">{toStatus}</span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <select aria-label="From status" value={fromStatus} onChange={(e) => setFromStatus(e.target.value)}>
                <option value="">From status…</option>
                {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select aria-label="To status" value={toStatus} onChange={(e) => setToStatus(e.target.value)}>
                <option value="">To status…</option>
                {statusOptions.filter((s) => s !== fromStatus).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          <label>Validator — require field before transition (optional)
            <select value={requiredField} onChange={(e) => setRequiredField(e.target.value)}>
              <option value="">None</option>
              <option value="assignee">assignee</option>
              <option value="resolution">resolution</option>
              <option value="priority">priority</option>
            </select>
          </label>
          <label>Post-function — set field (optional)
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={setField} onChange={(e) => setSetField(e.target.value)}>
                <option value="">None</option>
                <option value="assignee">assignee</option>
                <option value="resolution">resolution</option>
                <option value="priority">priority</option>
              </select>
              <input type="text" value={setValue} onChange={(e) => setSetValue(e.target.value)} placeholder="value" disabled={!setField} />
            </div>
          </label>
          <label>Post-function — add comment (optional)
            <input type="text" value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Comment text" />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {isEditing ? (
              <>
                <button type="button" className="btn btn-primary" onClick={handleUpdate}>
                  Save changes
                </button>
                <button type="button" className="btn btn-ghost" onClick={resetForm}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={handleAdd} disabled={!fromStatus || !toStatus || fromStatus === toStatus}>
                Add transition
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
