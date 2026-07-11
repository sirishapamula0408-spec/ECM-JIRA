import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControl, IconButton, InputLabel, List, ListItemButton, ListItemText,
  MenuItem, OutlinedInput, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { ISSUE_STATUSES, PRIORITIES } from '../../constants.js'
import { usePermissions } from '../../hooks/usePermissions.js'
import { fetchProjects } from '../../api/projectApi.js'
import {
  fetchQueues, fetchQueueIssues, createQueue, updateQueue, deleteQueue,
} from '../../api/queueApi.js'
import { EmptyState } from '../../components/common/EmptyState.jsx'
import './QueuesPage.css'

const SLA_CHIP_COLOR = { breached: 'error', at_risk: 'warning', ok: 'success' }
const SLA_CHIP_LABEL = { breached: 'Breached', at_risk: 'At risk', ok: 'On track' }

function SlaChip({ sla }) {
  if (!sla || !sla.status) return <Chip size="small" variant="outlined" label="No SLA" />
  return (
    <Chip
      size="small"
      color={SLA_CHIP_COLOR[sla.status] || 'default'}
      label={SLA_CHIP_LABEL[sla.status] || sla.status}
      title={sla.source === 'policy'
        ? `${sla.elapsedHours}h / ${sla.targetHours}h (${sla.percent}%)`
        : `Due ${sla.dueDate}`}
    />
  )
}

const emptyDraft = () => ({ name: '', description: '', projectId: '', orderBy: 'created_at', statuses: [], priorities: [], assignee: '' })

function QueueEditor({ open, onClose, onSave, projects, initial }) {
  const [draft, setDraft] = useState(emptyDraft())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setError('')
      if (initial) {
        const f = initial.filter || {}
        setDraft({
          name: initial.name || '',
          description: initial.description || '',
          projectId: initial.project_id || '',
          orderBy: initial.order_by || 'created_at',
          statuses: f.statuses || [],
          priorities: f.priorities || [],
          assignee: f.assignee || '',
        })
      } else {
        setDraft(emptyDraft())
      }
    }
  }, [open, initial])

  const handleSave = async () => {
    if (!draft.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description || null,
        projectId: draft.projectId || null,
        orderBy: draft.orderBy,
        filter: {
          statuses: draft.statuses,
          priorities: draft.priorities,
          ...(draft.assignee.trim() ? { assignee: draft.assignee.trim() } : {}),
        },
      }
      await onSave(payload)
      onClose()
    } catch (e) {
      setError(e?.message || 'Failed to save queue')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{initial ? 'Edit queue' : 'New queue'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Typography color="error" variant="body2">{error}</Typography>}
          <TextField label="Name" value={draft.name} required
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} fullWidth />
          <TextField label="Description" value={draft.description} multiline minRows={2}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} fullWidth />
          <FormControl fullWidth>
            <InputLabel id="q-project">Project (optional)</InputLabel>
            <Select labelId="q-project" label="Project (optional)" value={draft.projectId}
              onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value }))}>
              <MenuItem value=""><em>All projects</em></MenuItem>
              {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </Select>
          </FormControl>
          <Divider>Filter criteria</Divider>
          <FormControl fullWidth>
            <InputLabel id="q-statuses">Statuses</InputLabel>
            <Select labelId="q-statuses" multiple value={draft.statuses}
              input={<OutlinedInput label="Statuses" />}
              renderValue={(sel) => sel.join(', ')}
              onChange={(e) => setDraft((d) => ({ ...d, statuses: e.target.value }))}>
              {ISSUE_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel id="q-priorities">Priorities</InputLabel>
            <Select labelId="q-priorities" multiple value={draft.priorities}
              input={<OutlinedInput label="Priorities" />}
              renderValue={(sel) => sel.join(', ')}
              onChange={(e) => setDraft((d) => ({ ...d, priorities: e.target.value }))}>
              {PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Assignee (exact name)" value={draft.assignee}
            onChange={(e) => setDraft((d) => ({ ...d, assignee: e.target.value }))} fullWidth />
          <FormControl fullWidth>
            <InputLabel id="q-order">Order by</InputLabel>
            <Select labelId="q-order" label="Order by" value={draft.orderBy}
              onChange={(e) => setDraft((d) => ({ ...d, orderBy: e.target.value }))}>
              {['created_at', 'due_date', 'priority', 'status', 'issue_key'].map((c) =>
                <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function QueuesPage() {
  const navigate = useNavigate()
  const { isAdmin } = usePermissions()
  const [queues, setQueues] = useState([])
  const [projects, setProjects] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [issuesData, setIssuesData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [issuesLoading, setIssuesLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const selected = useMemo(() => queues.find((q) => q.id === selectedId) || null, [queues, selectedId])

  const loadQueues = useCallback(async () => {
    setLoading(true)
    try {
      const [qs, ps] = await Promise.all([fetchQueues(), fetchProjects()])
      setQueues(qs)
      setProjects(ps)
      setSelectedId((prev) => prev ?? (qs[0]?.id ?? null))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadQueues() }, [loadQueues])

  useEffect(() => {
    if (!selectedId) { setIssuesData(null); return }
    let cancelled = false
    setIssuesLoading(true)
    fetchQueueIssues(selectedId)
      .then((d) => { if (!cancelled) setIssuesData(d) })
      .catch(() => { if (!cancelled) setIssuesData(null) })
      .finally(() => { if (!cancelled) setIssuesLoading(false) })
    return () => { cancelled = true }
  }, [selectedId, queues])

  const handleSave = async (payload) => {
    if (editing) await updateQueue(editing.id, payload)
    else await createQueue(payload)
    await loadQueues()
  }

  const handleDelete = async (q) => {
    if (!window.confirm(`Delete queue "${q.name}"?`)) return
    await deleteQueue(q.id)
    if (selectedId === q.id) setSelectedId(null)
    await loadQueues()
  }

  if (loading) {
    return <Box className="page" sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress /></Box>
  }

  return (
    <Box className="page queues-page">
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Queues</Typography>
        {isAdmin && (
          <Button variant="contained" startIcon={<AddIcon />}
            onClick={() => { setEditing(null); setEditorOpen(true) }}>New queue</Button>
        )}
      </Stack>

      <div className="queues-layout">
        <aside className="queues-sidebar">
          {queues.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No queues yet.</Typography>
          ) : (
            <List dense>
              {queues.map((q) => (
                <ListItemButton key={q.id} selected={q.id === selectedId} onClick={() => setSelectedId(q.id)}>
                  <ListItemText primary={q.name}
                    secondary={q.project_id ? `Project #${q.project_id}` : 'All projects'} />
                  {isAdmin && (
                    <>
                      <Tooltip title="Edit"><IconButton size="small"
                        onClick={(e) => { e.stopPropagation(); setEditing(q); setEditorOpen(true) }}>
                        <EditIcon fontSize="inherit" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small"
                        onClick={(e) => { e.stopPropagation(); handleDelete(q) }}>
                        <DeleteOutlineIcon fontSize="inherit" /></IconButton></Tooltip>
                    </>
                  )}
                </ListItemButton>
              ))}
            </List>
          )}
        </aside>

        <section className="queues-content">
          {!selected ? (
            <EmptyState icon="📋" title="Select a queue"
              description="Choose a queue from the list to see the issues a support team works from." />
          ) : (
            <>
              <Typography variant="h6">{selected.name}</Typography>
              {selected.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{selected.description}</Typography>
              )}
              {issuesLoading ? (
                <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>
              ) : !issuesData || issuesData.issues.length === 0 ? (
                <EmptyState icon="✅" title="No issues in this queue"
                  description="No issues currently match this queue's filter criteria." />
              ) : (
                <Table size="small" className="queues-table">
                  <TableHead>
                    <TableRow>
                      <TableCell>Key</TableCell>
                      <TableCell>Title</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Priority</TableCell>
                      <TableCell>Assignee</TableCell>
                      <TableCell>SLA</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {issuesData.issues.map((it) => (
                      <TableRow key={it.id} hover sx={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/issues/${it.id}`)}>
                        <TableCell>{it.issue_key}</TableCell>
                        <TableCell>{it.title}</TableCell>
                        <TableCell>{it.status}</TableCell>
                        <TableCell>{it.priority}</TableCell>
                        <TableCell>{it.assignee || '—'}</TableCell>
                        <TableCell><SlaChip sla={it.sla} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </section>
      </div>

      <QueueEditor open={editorOpen} onClose={() => setEditorOpen(false)} onSave={handleSave}
        projects={projects} initial={editing} />
    </Box>
  )
}

export default QueuesPage
