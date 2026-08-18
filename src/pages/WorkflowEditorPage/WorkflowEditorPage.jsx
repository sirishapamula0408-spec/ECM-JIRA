import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import { ISSUE_STATUSES } from '../../constants'
import { fetchProjects } from '../../api/projectApi'
import { fetchProjectStatuses, createStatus, deleteStatus } from '../../api/issueConfigApi'
import {
  fetchWorkflowTransitions,
  createWorkflowTransition,
  updateWorkflowTransition,
  deleteWorkflowTransition,
} from '../../api/workflowTransitionApi'
import {
  fetchWorkflowDefinitions,
  applyWorkflowTemplate,
  createWorkflowDefinition,
} from '../../api/workflowDefinitionApi'
import { fetchWorkflowLayout, saveWorkflowLayout } from '../../api/workflowLayoutApi'
import { readableTextColor, borderFor } from '../../utils/color'
import { snapToGrid } from '../../utils/layoutGrid' // JL-330: snap dropped nodes to the grid
import { usePermissions } from '../../hooks/usePermissions'
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning'
import { useConfirm } from '../../components/common/ConfirmDialog'
import './WorkflowEditorPage.css'
import { usePageTitle } from '../../hooks/usePageTitle'

// JL-307: compact Atlassian-style status nodes (previously 180×60 boxes). These
// constants are the single source of truth for node size — they drive BOTH the
// inline node dimensions and the SVG arrow start/end geometry, so drag,
// positioning and transition arrows stay in sync.
const NODE_WIDTH = 140
const NODE_HEIGHT = 44
const NUDGE_STEP = 10

// JL-324: transition-label placement. The label used to sit ON the arrow at its
// midpoint, which for two side-by-side nodes falls inside the node band and gets
// clipped by the boxes. Offsetting it by half a node height + a margin lifts it
// clear of the band entirely, so a label wider than the inter-node gap is still
// readable rather than overlapping. Labels are only dropped for degenerate
// arrows between (near-)overlapping nodes, where nothing would be legible.
const LABEL_OFFSET_SCALE = 1.6
const LABEL_CLEARANCE = NODE_HEIGHT / 2 + 10
const MIN_LABEL_SEGMENT = 40

// JL-276: quick-pick presets for the Add Status dialog. Backend `category` only
// allows 'todo' | 'inprogress' | 'done', so names like "In Code Review" are STATUS
// NAMES mapped onto one of those three categories — never new categories.
const STATUS_PRESETS = [
  { label: 'To Do', category: 'todo', color: '#dfe1e6' },
  { label: 'In Progress', category: 'inprogress', color: '#deebff' },
  { label: 'In Code Review', category: 'inprogress', color: '#eae6ff' },
  { label: 'In Testing / QA', category: 'inprogress', color: '#fffae6' },
  { label: 'Blocked', category: 'inprogress', color: '#ffebe6' },
  { label: 'Ready for Release', category: 'inprogress', color: '#e3fcef' },
  { label: 'Done', category: 'done', color: '#e3fcef' },
]

// Backend status categories are 'todo' | 'inprogress' | 'done'. Older demo data
// used 'in-progress'; normalize so both render.
function normalizeCategory(cat) {
  const c = String(cat || 'todo').toLowerCase()
  if (c === 'in-progress' || c === 'in progress') return 'inprogress'
  if (c === 'todo' || c === 'inprogress' || c === 'done') return c
  return 'todo'
}

// JL-324: Atlassian workflow-diagram surfaces — light fills with dark text.
// Previously to-do was blue and in-progress was yellow, which matched neither
// Jira nor STATUS_PRESETS above; all three palettes now agree.
//   to-do       → neutral  (N20 / N30)
//   in progress → blue subtle
//   done        → green subtle
const CATEGORY_STYLES = {
  'todo':       { bg: '#F4F5F7', color: '#42526E', border: '#DFE1E6', label: 'To Do' },
  'inprogress': { bg: '#DEEBFF', color: '#0052CC', border: '#B3D4FF', label: 'In Progress' },
  'done':       { bg: '#E3FCEF', color: '#006644', border: '#ABF5D1', label: 'Done' },
}

function categoryStyle(cat) {
  return CATEGORY_STYLES[normalizeCategory(cat)] || CATEGORY_STYLES.todo
}

// Auto-layout position for a status that has no saved coordinate yet.
function autoPos(i) {
  return { x: 60 + (i % 5) * 260, y: 70 + Math.floor(i / 5) * 170 }
}

// JL-330: the legacy localStorage layout key. Layouts now live on the server;
// this key is only read once per project so a pre-JL-330 local layout can be
// migrated up instead of being silently dropped (see loadLayout below).
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
  usePageTitle('Workflow Editor')
  // JL-269: workflow config (statuses/transitions) is workspace-Admin only.
  const { isAdmin } = usePermissions()
  const { confirm, confirmDialog } = useConfirm()

  // ── Shared, project-scoped state (drives BOTH the canvas and the Rules panel) ──
  const [projects, setProjects] = useState([])
  const [projectsError, setProjectsError] = useState(false) // JL-306: surface load failures
  const [projectId, setProjectId] = useState('')
  const [statuses, setStatuses] = useState([])
  const [transitions, setTransitions] = useState([])
  const [workflowDefs, setWorkflowDefs] = useState([]) // JL-306: named workflows
  // JL-334: projectId -> default workflow name, for the dropdown labels.
  const [projectWorkflowNames, setProjectWorkflowNames] = useState({})
  const [applyingTemplate, setApplyingTemplate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // JL-306: visible success confirmation after Publish / Apply QA Lifecycle.
  const [successMsg, setSuccessMsg] = useState('')

  // JL-330: node positions, keyed by status name, loaded from and saved to the
  // server so the layout is shared and device-independent.
  const [positions, setPositions] = useState({})
  const [layoutError, setLayoutError] = useState('')

  const [selectedNodeName, setSelectedNodeName] = useState(null)
  const [selectedTransId, setSelectedTransId] = useState(null)
  const [zoom, setZoom] = useState(1)

  // JL-324: drag-to-create-transition. `linkDrag` is null when idle; while
  // dragging from a node's connector it holds the source status, the live
  // pointer position (for the preview line) and the node currently hovered.
  // Kept separate from `dragging` (node repositioning) so the two never mix.
  const [linkDrag, setLinkDrag] = useState(null)
  const [linkError, setLinkError] = useState('')

  // Add status modal
  const [showAddStatus, setShowAddStatus] = useState(false)
  const [newStatusName, setNewStatusName] = useState('')
  const [newStatusCategory, setNewStatusCategory] = useState('todo')
  const [newStatusColor, setNewStatusColor] = useState('#F4F5F7')
  const [newStatusPreset, setNewStatusPreset] = useState('')
  const [modalBusy, setModalBusy] = useState(false)
  const [modalError, setModalError] = useState('')

  // Add transition modal
  const [showAddTransition, setShowAddTransition] = useState(false)
  const [newTransFrom, setNewTransFrom] = useState('')
  const [newTransTo, setNewTransTo] = useState('')

  // JL-242: warn on tab close/refresh while an add-status/add-transition
  // dialog has in-progress input that would be lost (not merely open).
  const hasUnsavedEdits =
    (showAddStatus && newStatusName.trim() !== '') ||
    (showAddTransition && (newTransFrom !== '' || newTransTo !== ''))
  useUnsavedChangesWarning(hasUnsavedEdits)
  // JL-306: Publish (create a custom named workflow from the current canvas) modal
  const [showPublish, setShowPublish] = useState(false)
  const [publishName, setPublishName] = useState('')
  const [publishInitial, setPublishInitial] = useState('')
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishError, setPublishError] = useState('')

  const dragging = useRef(null)
  const didDrag = useRef(false)
  const canvasWrapperRef = useRef(null)
  const persistTimer = useRef(null)
  // JL-330: `isAdmin` read from inside the project-load effect without making it
  // a dependency (the effect must not re-run and re-fetch on a permission
  // refresh).
  const isAdminRef = useRef(isAdmin)
  isAdminRef.current = isAdmin

  // JL-330: pointer events are one code path for mouse, touch and pen, so the
  // canvas is draggable on a tablet without a parallel touch handler set. The
  // mouse handlers stay wired only as a fallback for environments that never
  // emit pointer events; the first pointer event latches this ref and every
  // later mouse event is ignored, so a browser firing both `pointerdown` and
  // its `mousedown` compatibility event cannot run one gesture twice.
  const pointerSeen = useRef(false)
  // Latches for the duration of a drag so the gesture is completed exactly
  // once. Touch fires `pointerup` and then immediately `pointerleave`, both of
  // which end a drag.
  const gestureActive = useRef(false)
  const addStatusBtnRef = useRef(null)
  const addTransBtnRef = useRef(null)

  /** True when this event is a mouse compatibility event we should ignore. */
  const isRedundantMouseEvent = useCallback((e) => {
    const type = String(e?.type || '')
    if (type.startsWith('pointer')) {
      pointerSeen.current = true
      return false
    }
    return pointerSeen.current
  }, [])

  // ── Load project list on mount, default to first ──
  useEffect(() => {
    let cancelled = false
    fetchProjects()
      .then(async (list) => {
        if (cancelled) return
        const projectList = list || []
        setProjects(projectList)
        setProjectsError(false)
        if (projectList.length > 0) setProjectId(String(projectList[0].id))

        // JL-334: resolve each project's default workflow so the dropdown can
        // name it. Best-effort and non-blocking — the selector still works if
        // this fails, options just fall back to the bare project name.
        const entries = await Promise.all(
          projectList.map(async (p) => {
            try {
              const defs = await fetchWorkflowDefinitions(p.id)
              const def = (defs || []).find((w) => w.isDefault)
              return [p.id, def?.name || null]
            } catch {
              return [p.id, null]
            }
          }),
        )
        if (!cancelled) setProjectWorkflowNames(Object.fromEntries(entries))
      })
      // JL-306: don't silently swallow — remember the failure so the UI can explain it.
      .catch(() => { if (!cancelled) { setProjects([]); setProjectsError(true) } })
    return () => { cancelled = true }
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
      // JL-306: named workflow metadata is optional — never fail the load on it.
      fetchWorkflowDefinitions(id).catch(() => []),
    ])
      .then(([sts, trs, defs]) => {
        setStatuses(sts || [])
        setTransitions(trs || [])
        setWorkflowDefs(defs || [])
      })
      .catch((e) => setError(e?.message || 'Failed to load workflow'))
      .finally(() => setLoading(false))
  }, [projectId])

  // JL-306: apply the built-in QA Lifecycle template to the selected project. Seeds
  // the QA states + transition graph and marks it the project's default workflow.
  const handleApplyQaLifecycle = useCallback(async () => {
    if (!projectId) return
    const ok = await confirm({
      title: 'Apply QA Lifecycle workflow?',
      message:
        'This seeds the QA Lifecycle states (Backlog, To Do, In Progress, In Testing, In Rework, In UAT, Done, Cancelled) and its transitions, and sets it as this project’s default workflow. Cancel is allowed from any active state.',
      confirmLabel: 'Apply workflow',
    })
    if (!ok) return
    setApplyingTemplate(true)
    setError('')
    try {
      await applyWorkflowTemplate(projectId, 'qa-lifecycle')
      await reload(projectId)
      setSuccessMsg('QA Lifecycle applied as the default workflow.')
    } catch (e) {
      setError(e?.message || 'Failed to apply the QA Lifecycle workflow')
    } finally {
      setApplyingTemplate(false)
    }
  }, [projectId, confirm, reload])

  // ── JL-330: load the node layout from the server, migrating a legacy local one ──
  //
  // Resolution order, chosen so no layout is ever silently lost:
  //   1. the server's layout wins whenever it has any coordinates — it is the
  //      shared, cross-device source of truth;
  //   2. server empty + a pre-JL-330 localStorage layout present → adopt the
  //      local layout, push it up, and only then delete the local key (a failed
  //      upload leaves the key in place so the next load retries);
  //   3. the GET itself failing (offline, older API) falls back to the local
  //      layout rather than resetting the diagram to auto-layout.
  // Only an Admin can migrate, because only an Admin may write the layout; a
  // Viewer keeps rendering their local one and keeps the key.
  const loadLayout = useCallback(async (pid) => {
    let server = null
    try {
      const res = await fetchWorkflowLayout(pid)
      const p = res?.positions
      server = p && typeof p === 'object' && !Array.isArray(p) ? p : {}
    } catch {
      server = null // unreachable — distinct from "reachable and empty"
    }
    const local = readPositions(pid)
    if (server && Object.keys(server).length > 0) return server
    if (Object.keys(local).length > 0) {
      if (server && isAdminRef.current) {
        try {
          await saveWorkflowLayout(pid, local)
          try { localStorage.removeItem(positionsKey(pid)) } catch { /* ignore */ }
        } catch { /* keep the local copy and retry on the next load */ }
      }
      return local
    }
    return server || {}
  }, [])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setPositions({})
    setSelectedNodeName(null)
    setSelectedTransId(null)
    loadLayout(projectId).then((map) => { if (!cancelled) setPositions(map) })
    reload(projectId)
    return () => { cancelled = true }
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
  // JL-330: this wrote localStorage, which is why layouts were per-device. It
  // now PUTs the whole map to the workflow-layout endpoint, still debounced so a
  // drag produces one request rather than one per frame. Writing is Admin-only
  // (the same gate as every other workflow edit), so a Viewer's drag stays
  // purely visual instead of generating 403s.
  const persistPositions = useCallback((map) => {
    if (!projectId || !isAdmin) return
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      saveWorkflowLayout(projectId, map).catch(() => {
        setLayoutError('Could not save the workflow layout. Your changes may not be visible to teammates.')
      })
    }, 250)
  }, [projectId, isAdmin])

  // ── Convert a pointer/mouse event to canvas coordinates ──
  function toCanvasCoords(e) {
    const wrapper = canvasWrapperRef.current
    if (!wrapper) return { x: 0, y: 0 }
    const rect = wrapper.getBoundingClientRect()
    const x = (e.clientX - rect.left + wrapper.scrollLeft) / zoom
    const y = (e.clientY - rect.top + wrapper.scrollTop) / zoom
    return { x, y }
  }

  // ── Drag handlers (JL-330: pointer-based, so mouse/touch/pen share one path) ──
  const handleNodeDragStart = useCallback((e, name) => {
    if (!isAdmin || isRedundantMouseEvent(e)) return
    e.stopPropagation()
    e.preventDefault()
    const node = nodeByName(name)
    if (!node) return
    const pos = toCanvasCoords(e)
    dragging.current = { name, offsetX: pos.x - node.x, offsetY: pos.y - node.y }
    didDrag.current = false
    gestureActive.current = true
    setSelectedNodeName(name)
    setSelectedTransId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeByName, zoom, isAdmin, isRedundantMouseEvent])

  // ── JL-324: drag from a node's connector onto another node to create a transition ──
  const handleConnectorDragStart = useCallback((e, name) => {
    if (!isAdmin || isRedundantMouseEvent(e)) return
    // Stop the node's own drag-start from starting a reposition drag.
    e.stopPropagation()
    e.preventDefault()
    const pos = toCanvasCoords(e)
    setLinkError('')
    gestureActive.current = true
    setLinkDrag({ from: name, x: pos.x, y: pos.y, hoverTarget: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, zoom, isRedundantMouseEvent])

  /** Which status node (if any) sits under the given canvas point. */
  const nodeAtPoint = useCallback((x, y) => {
    return nodes.find(
      (n) => x >= n.x && x <= n.x + NODE_WIDTH && y >= n.y && y <= n.y + NODE_HEIGHT,
    ) || null
  }, [nodes])

  const handleCanvasDragMove = useCallback((e) => {
    if (isRedundantMouseEvent(e)) return
    if (linkDrag) {
      const pos = toCanvasCoords(e)
      const over = nodeAtPoint(pos.x, pos.y)
      setLinkDrag((prev) => (prev
        ? { ...prev, x: pos.x, y: pos.y, hoverTarget: over && over.name !== prev.from ? over.name : null }
        : prev))
      return
    }
    if (!dragging.current) return
    didDrag.current = true
    const pos = toCanvasCoords(e)
    const x = Math.max(0, pos.x - dragging.current.offsetX)
    const y = Math.max(0, pos.y - dragging.current.offsetY)
    setPositions((prev) => ({ ...prev, [dragging.current.name]: { x, y } }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, linkDrag, nodeAtPoint, isRedundantMouseEvent])

  const handleCanvasDragEnd = useCallback(async (e) => {
    if (isRedundantMouseEvent(e)) return
    // Touch fires pointerup then pointerleave; complete the gesture once only.
    if (!gestureActive.current) return
    gestureActive.current = false
    if (linkDrag) {
      const { from, hoverTarget } = linkDrag
      setLinkDrag(null)
      // Self-drop and drops on empty canvas are no-ops, not errors.
      if (!hoverTarget || hoverTarget === from) return
      const exists = transitions.some((t) => t.fromStatus === from && t.toStatus === hoverTarget)
      if (exists) {
        setLinkError(`A transition from "${from}" to "${hoverTarget}" already exists.`)
        return
      }
      try {
        await createWorkflowTransition(projectId, { fromStatus: from, toStatus: hoverTarget })
        await reload(projectId)
      } catch (err) {
        setLinkError(err?.message || 'Failed to create transition')
      }
      return
    }
    if (dragging.current) {
      const { name } = dragging.current
      dragging.current = null
      // A press with no movement is a selection, not a move — nothing to snap
      // or save.
      if (!didDrag.current) return
      // JL-330: snap the dropped node onto the grid, then persist. Snapping on
      // drop (not during the drag) keeps the node under the pointer while
      // dragging and only aligns it once, which is what makes a diagram tidy
      // without the drag feeling sticky.
      setPositions((prev) => {
        const cur = prev[name]
        if (!cur) { persistPositions(prev); return prev }
        const next = { ...prev, [name]: { x: snapToGrid(cur.x), y: snapToGrid(cur.y) } }
        persistPositions(next)
        return next
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistPositions, linkDrag, transitions, projectId, isRedundantMouseEvent])

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
      // JL-330: clear the shared layout too, otherwise "Reset" only reset this
      // browser and the old coordinates came back on the next load. Cancel any
      // debounced save first so it cannot resurrect what we just cleared.
      if (isAdmin) {
        if (persistTimer.current) clearTimeout(persistTimer.current)
        saveWorkflowLayout(projectId, {}).catch(() => {
          setLayoutError('Could not reset the workflow layout on the server.')
        })
      }
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
    setNewStatusColor('#F4F5F7')
    setNewStatusPreset('')
    setModalError('')
    setShowAddStatus(true)
  }

  // JL-276: applying a preset pre-fills name + category + color (all still editable).
  const applyStatusPreset = (label) => {
    setNewStatusPreset(label)
    const preset = STATUS_PRESETS.find((p) => p.label === label)
    if (!preset) return
    setNewStatusName(preset.label)
    setNewStatusCategory(preset.category)
    setNewStatusColor(preset.color)
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

  // ── Publish (JL-306): persist the customised canvas as a named custom workflow ──
  // Statuses/transitions already persist individually as they are added; Publish
  // captures the current graph into a project_workflows row and marks it the
  // project default (which is what drives status-change enforcement). ensureStatuses
  // / ensureTransitions on the backend are idempotent, so re-sending the current
  // graph is safe.
  const openPublish = () => {
    setPublishError('')
    const currentDefault = workflowDefs.find((w) => w.isDefault)
    setPublishName(currentDefault?.name || 'Custom Workflow')
    setPublishInitial(statusNames[0] || '')
    setShowPublish(true)
  }

  const handlePublish = async () => {
    const name = publishName.trim()
    if (!name || !projectId || statuses.length === 0) return
    setPublishBusy(true)
    setPublishError('')
    try {
      const states = statuses.map((s) => ({
        name: typeof s === 'string' ? s : s?.name,
        category: normalizeCategory(typeof s === 'object' ? s?.category : 'todo'),
        color: (typeof s === 'object' ? s?.color : null) || undefined,
      }))
      const transitionsPayload = transitions.map((t) => ({
        fromStatus: t.fromStatus,
        toStatus: t.toStatus,
      }))
      const terminalStatuses = states
        .filter((s) => s.category === 'done')
        .map((s) => s.name)
      // JL-331: openPublish pre-fills the name with the current default, so
      // Publish usually name-matches an existing row and updates it. Carry that
      // row's cancel settings forward explicitly — publishing the diagram must
      // not quietly disable cancel-from-any (which would make cancelling an
      // issue impossible). The backend also treats omitted fields as
      // "unchanged" now; sending them keeps the intent visible at the call site.
      const existingDefault = workflowDefs.find(
        (w) => String(w.name).toLowerCase() === name.toLowerCase(),
      ) || defaultWorkflow

      await createWorkflowDefinition(projectId, {
        name,
        states,
        transitions: transitionsPayload,
        initialStatus: publishInitial || null,
        terminalStatuses,
        cancelFromAny: existingDefault?.cancelFromAny ?? false,
        cancelStatus: existingDefault?.cancelStatus ?? null,
        isDefault: true,
      })
      setShowPublish(false)
      await reload(projectId)
      setSuccessMsg(`Published "${name}" as this project's default workflow.`)
    } catch (e) {
      setPublishError(e?.message || 'Failed to publish workflow')
    } finally {
      setPublishBusy(false)
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
  // JL-306: the project's active (default) named workflow, if one has been applied.
  const defaultWorkflow = workflowDefs.find((w) => w.isDefault) || null

  // JL-334: keep the dropdown label in step with the toolbar badge after an
  // Apply-template or Publish changes the current project's default workflow.
  useEffect(() => {
    if (!projectId) return
    const name = defaultWorkflow?.name || null
    setProjectWorkflowNames((prev) => (
      prev[projectId] === name ? prev : { ...prev, [projectId]: name }
    ))
  }, [projectId, defaultWorkflow])

  const canAddTransition = statusNames.length >= 2

  return (
    <section className="workflow-editor-page">
      {/* Header */}
      <div className="wfe-header">
        <div className="wfe-header-left">
          <h1>Workflow Editor</h1>
          <label className="wfe-project-select-label">
            <span className="visually-hidden">Project</span>
            <select
              className="wfe-project-select"
              aria-label="Project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Select project…</option>
              {/* JL-334: show each project's default workflow in the option, so
                  the workflow is identifiable from the dropdown itself rather
                  than only from the toolbar badge on the row below. */}
              {projects.map((p) => {
                const label = p.name || p.key || `Project ${p.id}`
                const wf = projectWorkflowNames[p.id]
                return (
                  <option key={p.id} value={p.id}>
                    {wf ? `${label} — ${wf}` : label}
                  </option>
                )
              })}
            </select>
          </label>
          {/* JL-306: make a failed/empty project load visible instead of dead buttons */}
          {projectsError ? (
            <span className="wfe-project-hint wfe-project-hint--error" role="alert">
              Couldn’t load projects — is the server running?
            </span>
          ) : projects.length === 0 ? (
            <span className="wfe-project-hint muted">No projects yet</span>
          ) : null}
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
                title={!projectId ? 'Select a project first' : 'Add a new status to this workflow'}
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
                title={
                  !projectId
                    ? 'Select a project first'
                    : !canAddTransition
                      ? 'Add at least two statuses first'
                      : 'Add a transition between two statuses'
                }
                aria-label="Add transition"
              >
                <span aria-hidden="true">→</span> Add transition
              </button>
              <button
                type="button"
                className="wfe-toolbar-btn"
                onClick={handleApplyQaLifecycle}
                disabled={!projectId || applyingTemplate}
                title={!projectId ? 'Select a project first' : 'Seed the built-in QA Lifecycle workflow'}
                aria-label="Apply QA Lifecycle template"
              >
                <span aria-hidden="true">✔</span> {applyingTemplate ? 'Applying…' : 'Apply QA Lifecycle'}
              </button>
              <button
                type="button"
                className="wfe-toolbar-btn wfe-toolbar-btn--primary"
                onClick={openPublish}
                disabled={!projectId || statusNames.length === 0 || publishBusy}
                title={
                  !projectId
                    ? 'Select a project first'
                    : statusNames.length === 0
                      ? 'Add at least one status first'
                      : 'Publish the current statuses & transitions as this project’s default workflow'
                }
                aria-label="Publish workflow"
              >
                <span aria-hidden="true">⇧</span> {publishBusy ? 'Publishing…' : 'Publish workflow'}
              </button>
            </>
          ) : (
            <span className="wfe-readonly-hint muted">Workspace Admins can configure the workflow.</span>
          )}
          {/* JL-324: previously this rendered nothing at all when a project had
              no default workflow — indistinguishable from a failed fetch. Say so
              explicitly instead. */}
          {defaultWorkflow ? (
            <span className="wfe-default-workflow-badge" data-testid="wfe-default-workflow">
              Default workflow: {defaultWorkflow.name}
              {defaultWorkflow.cancelFromAny && ' · cancel from any'}
            </span>
          ) : projectId && !loading && (
            <span className="wfe-no-default-workflow-badge" data-testid="wfe-no-default-workflow">
              No default workflow
            </span>
          )}
        </div>
        <div className="wfe-toolbar-right">
          <button type="button" className="wfe-zoom-btn" onClick={handleZoomIn} aria-label="Zoom in">+</button>
          <span className="wfe-zoom-label">{Math.round(zoom * 100)}%</span>
          <button type="button" className="wfe-zoom-btn" onClick={handleZoomOut} aria-label="Zoom out">−</button>
        </div>
      </div>

      {/* Main: two columns — canvas (left, max width) + sidebar (right) */}
      <div className="wfe-main">
        {/* Canvas column */}
        <div className="wfe-canvas-column" data-testid="wfe-canvas-column">
        <div
          ref={canvasWrapperRef}
          className="wfe-canvas-wrapper"
          // JL-330: pointer handlers cover mouse, touch and pen; the mouse pair
          // remains as a fallback and is ignored once any pointer event is seen.
          onPointerMove={handleCanvasDragMove}
          onPointerUp={handleCanvasDragEnd}
          onPointerCancel={handleCanvasDragEnd}
          onPointerLeave={handleCanvasDragEnd}
          onMouseMove={handleCanvasDragMove}
          onMouseUp={handleCanvasDragEnd}
          onMouseLeave={handleCanvasDragEnd}
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
                {/* JL-333: markerUnits defaults to 'strokeWidth', which multiplied
                    the head by the line width — 20×14px normally and 30×21px when
                    selected, i.e. half the height of a 44px node, and it grew on
                    hover. Pin it to userSpaceOnUse so the head is a fixed 8×6px
                    like Atlassian's. */}
                <defs>
                  <marker
                    id="wfe-arrowhead"
                    markerUnits="userSpaceOnUse"
                    markerWidth="8" markerHeight="6" refX="8" refY="3"
                    orient="auto"
                  >
                    <polygon points="0 0, 8 3, 0 6" fill="#8993A4" />
                  </marker>
                  <marker
                    id="wfe-arrowhead-sel"
                    markerUnits="userSpaceOnUse"
                    markerWidth="8" markerHeight="6" refX="8" refY="3"
                    orient="auto"
                  >
                    <polygon points="0 0, 8 3, 0 6" fill="#0052cc" />
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
                  // JL-333: the 12px gap was sized for the old oversized head;
                  // 6px suits the fixed 8×6 marker without touching the node.
                  const endX = to.x - ux * (NODE_WIDTH / 2 + 6) + px
                  const endY = to.y - uy * (NODE_HEIGHT / 2 + 6) + py

                  const segLen = Math.hypot(endX - startX, endY - startY)
                  const labelText = t.name || `${t.fromStatus} → ${t.toStatus}`
                  const showArrowLabel = isSelected || segLen >= MIN_LABEL_SEGMENT

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
                        stroke={isSelected ? '#0052cc' : '#8993A4'}
                        strokeWidth={isSelected ? 2 : 1.5}
                        markerEnd={isSelected ? 'url(#wfe-arrowhead-sel)' : 'url(#wfe-arrowhead)'}
                      />
                      {/* JL-324: the label used to sit exactly at the arrow
                          midpoint reading "From → To", which for adjacent nodes
                          landed on top of a status box and duplicated what the
                          arrow already shows. Push it clear along the segment's
                          perpendicular and drop the redundant endpoint names —
                          a white halo (CSS paint-order) keeps it legible over
                          the dotted canvas. */}
                      {showArrowLabel && (
                        <text
                          className="wfe-arrow-label"
                          x={(startX + endX) / 2 + px * LABEL_OFFSET_SCALE - uy * LABEL_CLEARANCE}
                          y={(startY + endY) / 2 + py * LABEL_OFFSET_SCALE + ux * LABEL_CLEARANCE}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          {labelText}
                        </text>
                      )}
                    </g>
                  )
                })}

                {/* JL-324: live preview while dragging a new transition */}
                {linkDrag && (() => {
                  const from = getNodeCenter(linkDrag.from)
                  if (!from) return null
                  return (
                    <g className="wfe-link-preview" data-testid="wfe-link-preview">
                      <line
                        x1={from.x} y1={from.y}
                        x2={linkDrag.x} y2={linkDrag.y}
                        markerEnd="url(#wfe-arrowhead-sel)"
                      />
                    </g>
                  )
                })()}
              </svg>

              {/* Nodes */}
              {nodes.map((node) => {
                const style = categoryStyle(node.category)
                const selected = selectedNodeName === node.name
                const fill = node.color || style.bg
                const isLinkSource = linkDrag?.from === node.name
                const isLinkTarget = linkDrag?.hoverTarget === node.name
                return (
                  <div
                    key={node.name}
                    className={
                      `wfe-node${selected ? ' wfe-node--selected' : ''}` +
                      `${isLinkSource ? ' wfe-node--link-source' : ''}` +
                      `${isLinkTarget ? ' wfe-node--link-target' : ''}`
                    }
                    data-status={node.name}
                    style={{
                      left: node.x,
                      top: node.y,
                      width: NODE_WIDTH,
                      height: NODE_HEIGHT,
                      // JL-324: `node.color` is NOT NULL in the DB, so it used to
                      // shadow style.bg entirely and `color: undefined` let dark
                      // body text land on a dark fill (~1.5:1). Derive the label
                      // and border from whatever fill wins, so legacy and custom
                      // colours stay legible too.
                      backgroundColor: fill,
                      borderColor: selected ? undefined : borderFor(fill),
                      color: readableTextColor(fill),
                    }}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={`Status ${node.name}, category ${style.label}`}
                    onPointerDown={(e) => handleNodeDragStart(e, node.name)}
                    onMouseDown={(e) => handleNodeDragStart(e, node.name)}
                    onClick={(e) => { e.stopPropagation(); setSelectedNodeName(node.name); setSelectedTransId(null) }}
                    onKeyDown={(e) => handleNodeKeyDown(e, node)}
                  >
                    {/* JL-324: the category sub-label (raw `todo`/`inprogress`/
                        `done`, rendered uppercase as INPROGRESS) is gone — the
                        category is still conveyed by fill colour and aria-label. */}
                    <div className="wfe-node-name">{node.name}</div>
                    {isAdmin && (
                      <span
                        className="wfe-node-connector"
                        role="button"
                        tabIndex={-1}
                        aria-label={`Drag from ${node.name} to create a transition`}
                        title="Drag to another status to create a transition"
                        onPointerDown={(e) => handleConnectorDragStart(e, node.name)}
                        onMouseDown={(e) => handleConnectorDragStart(e, node.name)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        </div>

        {/* Right sidebar: Properties (top) + Transition Rules (below) */}
        <aside className="wfe-sidebar" data-testid="wfe-sidebar">
        {/* Properties Panel */}
        <div className="wfe-properties">
          <h3 className="wfe-sidebar-heading">Properties</h3>
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

        {/* JL-79: Configurable workflow transition rules (persisted per project).
            JL-275: moved out of the full-width bottom slot into the right sidebar. */}
        <WorkflowRulesPanel
          isAdmin={isAdmin}
          projectId={projectId}
          statuses={statusNames}
          transitions={transitions}
          loading={loading}
          error={error}
          onChanged={() => reload(projectId)}
        />
        </aside>
      </div>

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
              <label htmlFor="wfe-new-status-preset">Preset (optional)</label>
              <select
                id="wfe-new-status-preset"
                value={newStatusPreset}
                onChange={(e) => applyStatusPreset(e.target.value)}
              >
                <option value="">Custom…</option>
                {STATUS_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </select>
            </div>
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

      {/* Publish Workflow Modal (JL-306) */}
      <Dialog
        open={showPublish}
        onClose={() => !publishBusy && setShowPublish(false)}
        aria-labelledby="wfe-publish-title"
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle id="wfe-publish-title">Publish workflow</DialogTitle>
        <DialogContent>
          <div className="wfe-modal-form">
            {publishError && <div className="alert alert-error" style={{ color: '#bf2600' }}>{publishError}</div>}
            <p className="muted" style={{ marginTop: 0 }}>
              Saves the current statuses and transitions as a named workflow and makes it this
              project’s default (used to enforce status changes).
            </p>
            <div className="wfe-modal-row">
              <label htmlFor="wfe-publish-name">Workflow name</label>
              <input
                id="wfe-publish-name"
                type="text"
                value={publishName}
                onChange={(e) => setPublishName(e.target.value)}
                placeholder="e.g. Custom Workflow"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handlePublish() }}
              />
            </div>
            <div className="wfe-modal-row">
              <label htmlFor="wfe-publish-initial">Initial status</label>
              <select
                id="wfe-publish-initial"
                value={publishInitial}
                onChange={(e) => setPublishInitial(e.target.value)}
              >
                <option value="">None</option>
                {statusNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPublish(false)} disabled={publishBusy} color="inherit">Cancel</Button>
          <Button onClick={handlePublish} disabled={!publishName.trim() || publishBusy} variant="contained">
            {publishBusy ? 'Publishing…' : 'Publish'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* JL-306: success confirmation for Publish / Apply QA Lifecycle */}
      <Snackbar
        open={!!successMsg}
        autoHideDuration={4000}
        onClose={() => setSuccessMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSuccessMsg('')}
          severity="success"
          variant="filled"
          sx={{ width: '100%' }}
        >
          {successMsg}
        </Alert>
      </Snackbar>

      {/* JL-324: feedback when a drag-to-connect can't create a transition */}
      <Snackbar
        open={!!linkError}
        autoHideDuration={5000}
        onClose={() => setLinkError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setLinkError('')}
          severity="warning"
          variant="filled"
          sx={{ width: '100%' }}
        >
          {linkError}
        </Alert>
      </Snackbar>

      {/* JL-330: the layout is shared state now, so a failed save has to be
          visible — silently keeping a local-only position is the defect this
          ticket fixes. */}
      <Snackbar
        open={!!layoutError}
        autoHideDuration={6000}
        onClose={() => setLayoutError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setLayoutError('')}
          severity="warning"
          variant="filled"
          sx={{ width: '100%' }}
        >
          {layoutError}
        </Alert>
      </Snackbar>

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

  // JL-242: warn on tab close/refresh while this form differs from the
  // transition's saved validators / post-functions (Admin edit mode only).
  const savedRequired = (trans.validators || []).find((v) => v.type === 'required_field')?.field || ''
  const savedSet = (trans.postFunctions || []).find((f) => f.type === 'set_field')
  const savedComment = (trans.postFunctions || []).find((f) => f.type === 'add_comment')?.text || ''
  const hasUnsavedEdits = Boolean(isAdmin) && (
    requiredField !== savedRequired ||
    setField !== (savedSet?.field || '') ||
    setValue !== (savedSet?.value || '') ||
    commentText !== savedComment
  )
  useUnsavedChangesWarning(hasUnsavedEdits)

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
    <div className="wfe-rules-panel" style={{ padding: '16px', borderTop: '1px solid var(--jira-border, #dfe1e6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h3 className="wfe-sidebar-heading" style={{ margin: 0 }}>Transition rules</h3>
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
