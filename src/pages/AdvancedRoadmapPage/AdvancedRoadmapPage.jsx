import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { usePermissions } from '../../hooks/usePermissions'
import {
  fetchAdvancedRoadmap, createDependency, deleteDependency,
  createTeamCapacity, deleteTeamCapacity,
} from '../../api/advancedRoadmapApi'
import './AdvancedRoadmapPage.css'

const DAY_MS = 1000 * 60 * 60 * 24
const ROW_H = 40
const BAR_H = 22
const LABEL_W = 220
const MIN_TRACK_W = 640

function toMs(d) {
  if (!d) return null
  const t = new Date(d).getTime()
  return Number.isNaN(t) ? null : t
}

// Compute the [min,max] date window across all dated epics.
function computeWindow(epics) {
  let min = Infinity
  let max = -Infinity
  for (const e of epics) {
    const s = toMs(e.startDate)
    const d = toMs(e.dueDate)
    if (s !== null) { min = Math.min(min, s); max = Math.max(max, s) }
    if (d !== null) { min = Math.min(min, d); max = Math.max(max, d) }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const now = Date.now()
    return { min: now - 30 * DAY_MS, max: now + 60 * DAY_MS }
  }
  // pad by ~5% each side
  const pad = Math.max(DAY_MS * 3, (max - min) * 0.05)
  return { min: min - pad, max: max + pad }
}

export function AdvancedRoadmapPage() {
  const { isAdmin, isOwner } = usePermissions()
  const canManage = isAdmin || isOwner

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [depDialogOpen, setDepDialogOpen] = useState(false)
  const [capDialogOpen, setCapDialogOpen] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    fetchAdvancedRoadmap()
      .then((res) => { setData(res); setError(null) })
      .catch((err) => setError(err.message || 'Failed to load roadmap'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  const epics = data?.epics || []
  const dependencies = data?.dependencies || []
  const capacities = data?.capacities || []
  const violations = data?.violations || []
  const capacityLoad = data?.capacityLoad || []
  const projects = data?.projects || []

  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.key || p.name]))
    return (id) => map.get(id) || `#${id}`
  }, [projects])

  const violatedEpicIds = useMemo(() => {
    const set = new Set()
    for (const v of violations) { set.add(v.fromEpicId); set.add(v.toEpicId) }
    return set
  }, [violations])

  // Timeline geometry
  const datedEpics = epics.filter((e) => toMs(e.startDate) !== null || toMs(e.dueDate) !== null)
  const win = useMemo(() => computeWindow(datedEpics), [datedEpics])
  const span = Math.max(1, win.max - win.min)
  const xOf = (ms) => ((ms - win.min) / span) * MIN_TRACK_W

  async function handleDeleteDep(id) {
    try { await deleteDependency(id); reload() } catch (e) { setError(e.message) }
  }
  async function handleDeleteCap(id) {
    try { await deleteTeamCapacity(id); reload() } catch (e) { setError(e.message) }
  }

  if (loading) {
    return (
      <div className="page advanced-roadmap-page">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      </div>
    )
  }

  return (
    <div className="page advanced-roadmap-page">
      <header className="page-header">
        <Typography variant="h5" component="h1" fontWeight={600}>Advanced Roadmap</Typography>
        <Typography variant="body2" color="text.secondary">
          Multi-project epic timeline with dependency and capacity awareness.
        </Typography>
      </header>

      {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}

      {/* Warnings */}
      {(violations.length > 0 || capacityLoad.some((c) => c.overloaded)) && (
        <Stack spacing={1} sx={{ my: 2 }}>
          {violations.map((v, i) => (
            <Alert key={`v${i}`} severity="error" icon={<WarningAmberIcon fontSize="inherit" />}>
              Dependency violation: {v.message || `Epic ${v.toEpicId} starts before epic ${v.fromEpicId} finishes`}
            </Alert>
          ))}
          {capacityLoad.filter((c) => c.overloaded).map((c, i) => (
            <Alert key={`c${i}`} severity="warning">
              Over capacity — team <strong>{c.teamName}</strong>
              {c.projectId ? ` (${projectName(c.projectId)})` : ''}: planned {c.plannedPoints} pts vs {c.capacityPoints} capacity.
            </Alert>
          ))}
        </Stack>
      )}

      {epics.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, mt: 2, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            No epics found across your accessible projects. Create an Epic with start/due dates to see it here.
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: 2, mt: 2, overflowX: 'auto' }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>Epic timeline</Typography>
          <div className="arm-timeline" style={{ minWidth: LABEL_W + MIN_TRACK_W + 24 }}>
            {epics.map((e) => {
              const s = toMs(e.startDate)
              const d = toMs(e.dueDate)
              const hasDates = s !== null && d !== null
              const left = hasDates ? xOf(Math.min(s, d)) : 0
              const width = hasDates ? Math.max(6, xOf(Math.max(s, d)) - xOf(Math.min(s, d))) : 0
              const violated = violatedEpicIds.has(e.id)
              return (
                <div key={e.id} className="arm-row" style={{ height: ROW_H }}>
                  <div className="arm-label" style={{ width: LABEL_W }}>
                    <Chip size="small" label={projectName(e.projectId)} sx={{ mr: 0.5 }} />
                    <span className="arm-key">{e.issueKey}</span> {e.title}
                  </div>
                  <div className="arm-track" style={{ width: MIN_TRACK_W }}>
                    {hasDates ? (
                      <Tooltip title={`${e.startDate} → ${e.dueDate} · ${e.rollup?.donePct ?? 0}% done · ${e.points} pts`}>
                        <div
                          className={`arm-bar${violated ? ' arm-bar-violated' : ''}`}
                          style={{ left, width, height: BAR_H, top: (ROW_H - BAR_H) / 2 }}
                        >
                          <div className="arm-bar-fill" style={{ width: `${e.rollup?.donePct ?? 0}%` }} />
                          <span className="arm-bar-text">{e.points} pts</span>
                        </div>
                      </Tooltip>
                    ) : (
                      <span className="arm-nodate">No dates set</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Paper>
      )}

      {/* Dependencies */}
      <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>Dependencies (finish → start)</Typography>
          {canManage && <Button size="small" variant="outlined" onClick={() => setDepDialogOpen(true)}>Add dependency</Button>}
        </Stack>
        {dependencies.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No dependencies defined.</Typography>
        ) : (
          <Stack spacing={0.5}>
            {dependencies.map((dep) => {
              const bad = violations.some((v) => v.dependencyId === dep.id)
              return (
                <Stack key={dep.id} direction="row" spacing={1} alignItems="center">
                  {bad && <WarningAmberIcon color="error" fontSize="small" />}
                  <Chip size="small" label={`#${dep.fromEpicId}`} />
                  <span>→</span>
                  <Chip size="small" label={`#${dep.toEpicId}`} />
                  <Typography variant="caption" color="text.secondary">{dep.type}</Typography>
                  {canManage && (
                    <IconButton size="small" onClick={() => handleDeleteDep(dep.id)} aria-label="Delete dependency">
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              )
            })}
          </Stack>
        )}
      </Paper>

      {/* Capacity */}
      <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>Team capacity</Typography>
          {canManage && <Button size="small" variant="outlined" onClick={() => setCapDialogOpen(true)}>Add capacity</Button>}
        </Stack>
        {capacities.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No team capacity configured.</Typography>
        ) : (
          <Stack spacing={0.5}>
            {capacities.map((c) => {
              const load = capacityLoad.find((l) => l.teamName === c.teamName && l.projectId === c.projectId)
              return (
                <Stack key={c.id} direction="row" spacing={1} alignItems="center">
                  <Chip size="small" color={load?.overloaded ? 'error' : 'default'}
                    label={`${c.teamName}${c.projectId ? ` · ${projectName(c.projectId)}` : ''}`} />
                  <Typography variant="body2">
                    {load ? `${load.plannedPoints} planned` : '—'} / {c.capacityPoints} pts
                  </Typography>
                  {c.periodStart && (
                    <Typography variant="caption" color="text.secondary">
                      {c.periodStart} → {c.periodEnd || '…'}
                    </Typography>
                  )}
                  {canManage && (
                    <IconButton size="small" onClick={() => handleDeleteCap(c.id)} aria-label="Delete capacity">
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              )
            })}
          </Stack>
        )}
      </Paper>

      {depDialogOpen && (
        <DependencyDialog
          epics={epics}
          onClose={() => setDepDialogOpen(false)}
          onSaved={() => { setDepDialogOpen(false); reload() }}
          onError={setError}
        />
      )}
      {capDialogOpen && (
        <CapacityDialog
          projects={projects}
          onClose={() => setCapDialogOpen(false)}
          onSaved={() => { setCapDialogOpen(false); reload() }}
          onError={setError}
        />
      )}
    </div>
  )
}

function DependencyDialog({ epics, onClose, onSaved, onError }) {
  const [fromEpicId, setFrom] = useState('')
  const [toEpicId, setTo] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!fromEpicId || !toEpicId || fromEpicId === toEpicId) return
    setSaving(true)
    try {
      await createDependency({ fromEpicId: Number(fromEpicId), toEpicId: Number(toEpicId), type: 'finish_to_start' })
      onSaved()
    } catch (e) { onError(e.message) } finally { setSaving(false) }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add dependency</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="From epic (must finish first)" value={fromEpicId} onChange={(e) => setFrom(e.target.value)} fullWidth>
            {epics.map((e) => <MenuItem key={e.id} value={e.id}>{e.issueKey} — {e.title}</MenuItem>)}
          </TextField>
          <TextField select label="To epic (starts after)" value={toEpicId} onChange={(e) => setTo(e.target.value)} fullWidth>
            {epics.map((e) => <MenuItem key={e.id} value={e.id}>{e.issueKey} — {e.title}</MenuItem>)}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving || !fromEpicId || !toEpicId || fromEpicId === toEpicId}>Add</Button>
      </DialogActions>
    </Dialog>
  )
}

function CapacityDialog({ projects, onClose, onSaved, onError }) {
  const [teamName, setTeamName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [capacityPoints, setCapacityPoints] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!teamName.trim() || capacityPoints === '' || Number(capacityPoints) < 0) return
    setSaving(true)
    try {
      await createTeamCapacity({
        teamName: teamName.trim(),
        projectId: projectId === '' ? null : Number(projectId),
        capacityPoints: Number(capacityPoints),
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
      })
      onSaved()
    } catch (e) { onError(e.message) } finally { setSaving(false) }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add team capacity</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} fullWidth required />
          <TextField select label="Project (optional)" value={projectId} onChange={(e) => setProjectId(e.target.value)} fullWidth>
            <MenuItem value="">All projects</MenuItem>
            {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.key || p.name}</MenuItem>)}
          </TextField>
          <TextField label="Capacity (points)" type="number" value={capacityPoints} onChange={(e) => setCapacityPoints(e.target.value)} fullWidth required />
          <TextField label="Period start" type="date" InputLabelProps={{ shrink: true }} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} fullWidth />
          <TextField label="Period end" type="date" InputLabelProps={{ shrink: true }} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving || !teamName.trim() || capacityPoints === ''}>Add</Button>
      </DialogActions>
    </Dialog>
  )
}

export default AdvancedRoadmapPage
