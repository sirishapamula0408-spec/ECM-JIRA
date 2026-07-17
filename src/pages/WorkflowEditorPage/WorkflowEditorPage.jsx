import { useState, useRef, useCallback, useEffect } from 'react'
import { ISSUE_STATUSES } from '../../constants'
import { fetchProjects } from '../../api/projectApi'
import {
  fetchWorkflowTransitions,
  createWorkflowTransition,
  deleteWorkflowTransition,
} from '../../api/workflowTransitionApi'
import './WorkflowEditorPage.css'

const NODE_WIDTH = 180
const NODE_HEIGHT = 60

const CATEGORY_MAP = {
  'Backlog': 'todo',
  'To Do': 'todo',
  'In Progress': 'in-progress',
  'Code Review': 'in-progress',
  'Done': 'done',
}

const CATEGORY_STYLES = {
  'todo':        { bg: '#DEEBFF', color: '#0052CC', border: '#4C9AFF', label: 'To Do' },
  'in-progress': { bg: '#FFF0B3', color: '#FF8B00', border: '#FFE380', label: 'In Progress' },
  'done':        { bg: '#E3FCEF', color: '#006644', border: '#79F2C0', label: 'Done' },
}

function buildDefaultNodes() {
  return ISSUE_STATUSES.map((name, i) => ({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    x: 80 + i * 280,
    y: 200,
    category: CATEGORY_MAP[name] || 'todo',
  }))
}

function buildDefaultTransitions(nodes) {
  return nodes.slice(0, -1).map((node, i) => ({
    id: `t${i + 1}`,
    from: node.id,
    to: nodes[i + 1].id,
    label: `${node.name} → ${nodes[i + 1].name}`,
  }))
}

let nextNodeId = 100
let nextTransId = 100

export function WorkflowEditorPage() {
  const [nodes, setNodes] = useState(() => buildDefaultNodes())
  const [transitions, setTransitions] = useState(() => buildDefaultTransitions(buildDefaultNodes()))
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [selectedTransId, setSelectedTransId] = useState(null)
  const [zoom, setZoom] = useState(1)

  // Add status modal
  const [showAddStatus, setShowAddStatus] = useState(false)
  const [newStatusName, setNewStatusName] = useState('')
  const [newStatusCategory, setNewStatusCategory] = useState('todo')

  // Add transition modal
  const [showAddTransition, setShowAddTransition] = useState(false)
  const [newTransFrom, setNewTransFrom] = useState('')
  const [newTransTo, setNewTransTo] = useState('')
  const [newTransLabel, setNewTransLabel] = useState('')

  const dragging = useRef(null)
  const didDrag = useRef(false)
  const canvasWrapperRef = useRef(null)

  // ---- Convert mouse event to canvas coordinates ----
  function toCanvasCoords(e) {
    const wrapper = canvasWrapperRef.current
    if (!wrapper) return { x: 0, y: 0 }
    const rect = wrapper.getBoundingClientRect()
    const x = (e.clientX - rect.left + wrapper.scrollLeft) / zoom
    const y = (e.clientY - rect.top + wrapper.scrollTop) / zoom
    return { x, y }
  }

  // ---- Drag handlers ----
  const handleNodeMouseDown = useCallback((e, nodeId) => {
    e.stopPropagation()
    e.preventDefault()
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return
    const pos = toCanvasCoords(e)
    dragging.current = {
      nodeId,
      offsetX: pos.x - node.x,
      offsetY: pos.y - node.y,
    }
    didDrag.current = false
    setSelectedNodeId(nodeId)
    setSelectedTransId(null)
  }, [nodes, zoom])

  const handleCanvasMouseMove = useCallback((e) => {
    if (!dragging.current) return
    didDrag.current = true
    const pos = toCanvasCoords(e)
    const x = pos.x - dragging.current.offsetX
    const y = pos.y - dragging.current.offsetY
    setNodes((prev) =>
      prev.map((n) =>
        n.id === dragging.current.nodeId
          ? { ...n, x: Math.max(0, x), y: Math.max(0, y) }
          : n
      )
    )
  }, [zoom])

  const handleCanvasMouseUp = useCallback(() => {
    dragging.current = null
  }, [])

  const handleCanvasClick = useCallback((e) => {
    // Only deselect if we didn't just finish a drag and click is on canvas background
    if (didDrag.current) {
      didDrag.current = false
      return
    }
    setSelectedNodeId(null)
    setSelectedTransId(null)
  }, [])

  const handleNodeClick = useCallback((e) => {
    // Stop click from reaching canvas (which would deselect)
    e.stopPropagation()
  }, [])

  const handleTransitionClick = useCallback((e, transId) => {
    e.stopPropagation()
    setSelectedTransId(transId)
    setSelectedNodeId(null)
  }, [])

  // ---- Zoom ----
  const handleZoomIn = () => setZoom((z) => Math.min(2.0, +(z + 0.1).toFixed(1)))
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))

  // ---- Add status ----
  const handleAddStatus = () => {
    if (!newStatusName.trim()) return
    const maxX = nodes.reduce((max, n) => Math.max(max, n.x), 0)
    setNodes((prev) => [
      ...prev,
      {
        id: `status-${nextNodeId++}`,
        name: newStatusName.trim(),
        x: maxX + 280,
        y: 200,
        category: newStatusCategory,
      },
    ])
    setNewStatusName('')
    setNewStatusCategory('todo')
    setShowAddStatus(false)
  }

  // ---- Add transition ----
  const handleAddTransition = () => {
    if (!newTransFrom || !newTransTo || newTransFrom === newTransTo) return
    setTransitions((prev) => [
      ...prev,
      {
        id: `t${nextTransId++}`,
        from: newTransFrom,
        to: newTransTo,
        label: newTransLabel.trim() || 'Transition',
      },
    ])
    setNewTransFrom('')
    setNewTransTo('')
    setNewTransLabel('')
    setShowAddTransition(false)
  }

  // ---- Delete ----
  const handleDeleteNode = (nodeId) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId))
    setTransitions((prev) => prev.filter((t) => t.from !== nodeId && t.to !== nodeId))
    setSelectedNodeId(null)
  }

  const handleDeleteTransition = (transId) => {
    setTransitions((prev) => prev.filter((t) => t.id !== transId))
    setSelectedTransId(null)
  }

  // ---- Discard ----
  const handleDiscard = () => {
    const freshNodes = buildDefaultNodes()
    setNodes(freshNodes)
    setTransitions(buildDefaultTransitions(freshNodes))
    setSelectedNodeId(null)
    setSelectedTransId(null)
    setZoom(1)
  }

  // ---- Helpers ----
  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  const selectedTrans = transitions.find((t) => t.id === selectedTransId)

  function getNodeCenter(nodeId) {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return { x: 0, y: 0 }
    return { x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT / 2 }
  }

  return (
    <section className="workflow-editor-page">
      {/* Header */}
      <div className="wfe-header">
        <div className="wfe-header-left">
          <h2>Workflow Editor</h2>
          <span className="wfe-workflow-name">Default Workflow</span>
        </div>
        <div className="wfe-header-actions">
          <button type="button" className="btn btn-ghost" onClick={handleDiscard}>
            Discard changes
          </button>
          <button type="button" className="btn btn-primary">
            Publish
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="wfe-toolbar">
        <div className="wfe-toolbar-left">
          <button type="button" className="wfe-toolbar-btn" onClick={() => { setNewStatusName(''); setNewStatusCategory('todo'); setShowAddStatus(true) }}>
            <span aria-hidden="true">+</span> Add status
          </button>
          <button
            type="button"
            className="wfe-toolbar-btn"
            onClick={() => {
              setNewTransFrom('')
              setNewTransTo('')
              setNewTransLabel('')
              setShowAddTransition(true)
            }}
          >
            <span aria-hidden="true">→</span> Add transition
          </button>
        </div>
        <div className="wfe-toolbar-right">
          <button type="button" className="wfe-zoom-btn" onClick={handleZoomIn} title="Zoom in">+</button>
          <span className="wfe-zoom-label">{Math.round(zoom * 100)}%</span>
          <button type="button" className="wfe-zoom-btn" onClick={handleZoomOut} title="Zoom out">−</button>
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
          <div
            className="wfe-canvas"
            style={{ transform: `scale(${zoom})` }}
          >
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
                const from = getNodeCenter(t.from)
                const to = getNodeCenter(t.to)
                if (!from.x && !from.y && !to.x && !to.y) return null
                const isSelected = selectedTransId === t.id

                // Compute offset for parallel transitions between the same pair
                const pairKey = [t.from, t.to].sort().join('|')
                const siblings = transitions.filter((s) => [s.from, s.to].sort().join('|') === pairKey)
                const sibIndex = siblings.indexOf(t)
                const sibCount = siblings.length
                const offsetAmount = sibCount > 1 ? (sibIndex - (sibCount - 1) / 2) * 16 : 0

                const dx = to.x - from.x
                const dy = to.y - from.y
                const dist = Math.sqrt(dx * dx + dy * dy) || 1
                const ux = dx / dist
                const uy = dy / dist
                // Perpendicular offset for parallel arrows
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
                    <line
                      className="wfe-arrow-hitarea"
                      x1={startX} y1={startY} x2={endX} y2={endY}
                    />
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
                      {t.label}
                    </text>
                  </g>
                )
              })}
            </svg>

            {/* Nodes */}
            {nodes.map((node) => {
              const style = CATEGORY_STYLES[node.category] || CATEGORY_STYLES['todo']
              return (
                <div
                  key={node.id}
                  className={`wfe-node${selectedNodeId === node.id ? ' wfe-node--selected' : ''}`}
                  style={{
                    left: node.x,
                    top: node.y,
                    backgroundColor: style.bg,
                    borderColor: style.border,
                    color: style.color,
                  }}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onClick={handleNodeClick}
                >
                  <div>
                    <div className="wfe-node-name">{node.name}</div>
                    <div className="wfe-node-category">{node.category}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Properties Panel */}
        <div className="wfe-properties">
          {selectedNode ? (
            <>
              <h3 className="wfe-properties-title">Status Properties</h3>
              <div className="wfe-prop-group">
                <span className="wfe-prop-label">Name</span>
                <span className="wfe-prop-value">{selectedNode.name}</span>
              </div>
              <div className="wfe-prop-group">
                <span className="wfe-prop-label">Category</span>
                <span
                  className="wfe-category-badge"
                  style={{
                    backgroundColor: CATEGORY_STYLES[selectedNode.category].bg,
                    color: CATEGORY_STYLES[selectedNode.category].color,
                  }}
                >
                  {CATEGORY_STYLES[selectedNode.category].label}
                </span>
              </div>
              <div className="wfe-prop-group">
                <span className="wfe-prop-label">Transitions from</span>
                {transitions.filter((t) => t.from === selectedNode.id).map((t) => {
                  const toNode = nodes.find((n) => n.id === t.to)
                  return (
                    <div key={t.id} className="wfe-transition-item">
                      → {toNode?.name || t.to}
                      <span className="wfe-transition-item-label">({t.label})</span>
                    </div>
                  )
                })}
                {transitions.filter((t) => t.from === selectedNode.id).length === 0 && (
                  <span className="muted">None</span>
                )}
              </div>
              <div className="wfe-prop-group">
                <span className="wfe-prop-label">Transitions to</span>
                {transitions.filter((t) => t.to === selectedNode.id).map((t) => {
                  const fromNode = nodes.find((n) => n.id === t.from)
                  return (
                    <div key={t.id} className="wfe-transition-item">
                      ← {fromNode?.name || t.from}
                      <span className="wfe-transition-item-label">({t.label})</span>
                    </div>
                  )
                })}
                {transitions.filter((t) => t.to === selectedNode.id).length === 0 && (
                  <span className="muted">None</span>
                )}
              </div>
              <button type="button" className="wfe-delete-btn" onClick={() => handleDeleteNode(selectedNode.id)}>
                ✕ Delete status
              </button>
            </>
          ) : selectedTrans ? (
            <>
              <h3 className="wfe-properties-title">Transition Properties</h3>
              <div className="wfe-prop-group">
                <span className="wfe-prop-label">Label</span>
                <span className="wfe-prop-value">{selectedTrans.label}</span>
              </div>
              <div className="wfe-prop-group">
                <span className="wfe-prop-label">From</span>
                <span className="wfe-prop-value">
                  {nodes.find((n) => n.id === selectedTrans.from)?.name || selectedTrans.from}
                </span>
              </div>
              <div className="wfe-prop-group">
                <span className="wfe-prop-label">To</span>
                <span className="wfe-prop-value">
                  {nodes.find((n) => n.id === selectedTrans.to)?.name || selectedTrans.to}
                </span>
              </div>
              <button type="button" className="wfe-delete-btn" onClick={() => handleDeleteTransition(selectedTrans.id)}>
                ✕ Delete transition
              </button>
            </>
          ) : (
            <div className="wfe-empty-props">
              <p>Properties</p>
              <p>Select a status or transition to view its properties.</p>
            </div>
          )}
        </div>
      </div>

      {/* JL-79: Configurable workflow transition rules (persisted per project) */}
      <WorkflowRulesPanel />

      {/* Add Status Modal */}
      {showAddStatus && (
        <div className="overlay" onClick={() => setShowAddStatus(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Status</h2>
            <div className="wfe-modal-form">
              <div className="wfe-modal-row">
                <label>Status name</label>
                <input
                  type="text"
                  value={newStatusName}
                  onChange={(e) => setNewStatusName(e.target.value)}
                  placeholder="e.g. QA Testing"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddStatus() }}
                />
              </div>
              <div className="wfe-modal-row">
                <label>Category</label>
                <select value={newStatusCategory} onChange={(e) => setNewStatusCategory(e.target.value)}>
                  <option value="todo">To Do</option>
                  <option value="in-progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowAddStatus(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleAddStatus} disabled={!newStatusName.trim()}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Transition Modal */}
      {showAddTransition && (
        <div className="overlay" onClick={() => setShowAddTransition(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add Transition</h2>
            <div className="wfe-modal-form">
              <div className="wfe-modal-row">
                <label>From status</label>
                <select value={newTransFrom} onChange={(e) => setNewTransFrom(e.target.value)}>
                  <option value="">Select status…</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>
              <div className="wfe-modal-row">
                <label>To status</label>
                <select value={newTransTo} onChange={(e) => setNewTransTo(e.target.value)}>
                  <option value="">Select status…</option>
                  {nodes.filter((n) => n.id !== newTransFrom).map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>
              <div className="wfe-modal-row">
                <label>Label</label>
                <input
                  type="text"
                  value={newTransLabel}
                  onChange={(e) => setNewTransLabel(e.target.value)}
                  placeholder="e.g. Move to review"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddTransition() }}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowAddTransition(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleAddTransition} disabled={!newTransFrom || !newTransTo || newTransFrom === newTransTo}>Add</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// JL-79: Panel to list/add/remove configurable workflow transitions for a project.
// Backend enforces these on issue status changes (deny -> 409, validator -> 400,
// allow -> apply post-functions). No transitions configured = all changes allowed.
function WorkflowRulesPanel() {
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [transitions, setTransitions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [fromStatus, setFromStatus] = useState('')
  const [toStatus, setToStatus] = useState('')
  const [requiredField, setRequiredField] = useState('')
  const [setField, setSetField] = useState('')
  const [setValue, setSetValue] = useState('')
  const [commentText, setCommentText] = useState('')

  useEffect(() => {
    fetchProjects()
      .then((list) => {
        setProjects(list || [])
        if (list && list.length > 0) setProjectId(String(list[0].id))
      })
      .catch(() => setProjects([]))
  }, [])

  const loadTransitions = useCallback((pid) => {
    if (!pid) { setTransitions([]); return }
    setLoading(true)
    fetchWorkflowTransitions(pid)
      .then((rows) => setTransitions(rows || []))
      .catch((e) => setError(e.message || 'Failed to load transitions'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadTransitions(projectId) }, [projectId, loadTransitions])

  const handleAdd = async () => {
    setError('')
    if (!projectId || !fromStatus || !toStatus || fromStatus === toStatus) return
    const validators = requiredField ? [{ type: 'required_field', field: requiredField }] : []
    const postFunctions = []
    if (setField) postFunctions.push({ type: 'set_field', field: setField, value: setValue })
    if (commentText.trim()) postFunctions.push({ type: 'add_comment', text: commentText.trim() })
    try {
      await createWorkflowTransition(projectId, { fromStatus, toStatus, validators, postFunctions })
      setFromStatus(''); setToStatus(''); setRequiredField(''); setSetField(''); setSetValue(''); setCommentText('')
      loadTransitions(projectId)
    } catch (e) {
      setError(e.message || 'Failed to add transition')
    }
  }

  const handleDelete = async (id) => {
    setError('')
    try {
      await deleteWorkflowTransition(id)
      loadTransitions(projectId)
    } catch (e) {
      setError(e.message || 'Failed to delete transition')
    }
  }

  return (
    <div className="wfe-rules-panel" style={{ padding: '16px 24px', borderTop: '1px solid var(--border, #dfe1e6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Transition Rules</h3>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Select project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name || p.key || `Project ${p.id}`}</option>
          ))}
        </select>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        When no transitions are configured for a project, all status changes are allowed.
      </p>

      {error && <div className="alert alert-error" style={{ color: '#bf2600', marginBottom: 8 }}>{error}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : transitions.length === 0 ? (
        <p className="muted">No transitions configured — all status changes are currently allowed.</p>
      ) : (
        <table className="wfe-rules-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: 6 }}>From</th>
              <th style={{ padding: 6 }}>To</th>
              <th style={{ padding: 6 }}>Validators</th>
              <th style={{ padding: 6 }}>Post-functions</th>
              <th style={{ padding: 6 }}></th>
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
                <td style={{ padding: 6 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => handleDelete(t.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {projectId && (
        <div className="wfe-rules-add" style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
          <strong>Add transition</strong>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={fromStatus} onChange={(e) => setFromStatus(e.target.value)}>
              <option value="">From status…</option>
              {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={toStatus} onChange={(e) => setToStatus(e.target.value)}>
              <option value="">To status…</option>
              {ISSUE_STATUSES.filter((s) => s !== fromStatus).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
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
          <div>
            <button type="button" className="btn btn-primary" onClick={handleAdd} disabled={!fromStatus || !toStatus || fromStatus === toStatus}>
              Add transition
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
