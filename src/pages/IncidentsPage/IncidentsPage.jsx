import { useEffect, useState, useCallback } from 'react'
import {
  Box, Paper, Typography, Button, Chip, TextField, MenuItem, Stack, Divider,
  List, ListItem, ListItemText, IconButton, Select, Alert,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { usePermissions } from '../../hooks/usePermissions'
import { EmptyState } from '../../components/common/EmptyState'
import {
  fetchIncidents, fetchIncident, createIncident, updateIncident, addTimelineEntry,
  fetchSchedules, createSchedule, deleteSchedule, fetchShifts, createShift, deleteShift,
  fetchCurrentOnCall,
} from '../../api/incidentApi'
import './IncidentsPage.css'

const SEVERITIES = ['SEV1', 'SEV2', 'SEV3', 'SEV4']
const STATUSES = ['open', 'investigating', 'identified', 'monitoring', 'resolved']

const SEV_COLOR = { SEV1: 'error', SEV2: 'warning', SEV3: 'info', SEV4: 'default' }
const STATUS_COLOR = {
  open: 'error', investigating: 'warning', identified: 'warning',
  monitoring: 'info', resolved: 'success',
}

function durationLabel(startedAt, resolvedAt) {
  const start = new Date(startedAt).getTime()
  const end = resolvedAt ? new Date(resolvedAt).getTime() : Date.now()
  const mins = Math.max(0, Math.floor((end - start) / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m`
}

export function IncidentsPage() {
  const { isAdmin } = usePermissions()
  const [incidents, setIncidents] = useState([])
  const [filter, setFilter] = useState({ status: '', severity: '' })
  const [selected, setSelected] = useState(null)
  const [newIncident, setNewIncident] = useState({ title: '', description: '', severity: 'SEV3' })
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  // On-call
  const [schedules, setSchedules] = useState([])
  const [activeSchedule, setActiveSchedule] = useState(null)
  const [shifts, setShifts] = useState([])
  const [onCall, setOnCall] = useState(null)
  const [newSchedule, setNewSchedule] = useState('')
  const [newShift, setNewShift] = useState({ userEmail: '', startsAt: '', endsAt: '' })

  const loadIncidents = useCallback(() => {
    fetchIncidents(filter)
      .then((d) => setIncidents(Array.isArray(d) ? d : []))
      .catch(() => setIncidents([]))
  }, [filter])

  useEffect(loadIncidents, [loadIncidents])

  const loadSchedules = useCallback(() => {
    fetchSchedules().then((d) => setSchedules(Array.isArray(d) ? d : [])).catch(() => setSchedules([]))
  }, [])

  useEffect(loadSchedules, [loadSchedules])

  const loadOnCall = useCallback((scheduleId) => {
    fetchCurrentOnCall(scheduleId).then((d) => setOnCall(d?.onCall || null)).catch(() => setOnCall(null))
    if (scheduleId) {
      fetchShifts(scheduleId).then((d) => setShifts(Array.isArray(d) ? d : [])).catch(() => setShifts([]))
    } else {
      setShifts([])
    }
  }, [])

  useEffect(() => { loadOnCall(activeSchedule) }, [activeSchedule, loadOnCall])

  async function openDetail(id) {
    try {
      const data = await fetchIncident(id)
      setSelected(data)
    } catch {
      setError('Failed to load incident')
    }
  }

  async function handleCreate() {
    setError('')
    if (!newIncident.title.trim()) return
    try {
      const created = await createIncident(newIncident)
      setNewIncident({ title: '', description: '', severity: 'SEV3' })
      loadIncidents()
      setSelected(created)
    } catch (e) {
      setError(e?.data?.error || 'Failed to create incident')
    }
  }

  async function handleStatus(status) {
    if (!selected) return
    await updateIncident(selected.id, { status })
    await openDetail(selected.id)
    loadIncidents()
  }

  async function handleSeverity(severity) {
    if (!selected) return
    await updateIncident(selected.id, { severity })
    await openDetail(selected.id)
    loadIncidents()
  }

  async function handleAddNote() {
    if (!selected || !note.trim()) return
    await addTimelineEntry(selected.id, { note })
    setNote('')
    await openDetail(selected.id)
  }

  async function handleCreateSchedule() {
    if (!newSchedule.trim()) return
    await createSchedule({ name: newSchedule })
    setNewSchedule('')
    loadSchedules()
  }

  async function handleAddShift() {
    if (!activeSchedule || !newShift.userEmail.trim() || !newShift.startsAt || !newShift.endsAt) return
    await createShift(activeSchedule, {
      userEmail: newShift.userEmail,
      startsAt: new Date(newShift.startsAt).toISOString(),
      endsAt: new Date(newShift.endsAt).toISOString(),
    })
    setNewShift({ userEmail: '', startsAt: '', endsAt: '' })
    loadOnCall(activeSchedule)
  }

  return (
    <Box className="page incidents-page" sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>Incidents & On-call</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* On-call widget */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <Typography variant="h6">On-call</Typography>
          <Select
            size="small"
            displayEmpty
            value={activeSchedule || ''}
            onChange={(e) => setActiveSchedule(e.target.value || null)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All schedules</MenuItem>
            {schedules.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
          </Select>
          <Chip
            color={onCall ? 'success' : 'default'}
            label={onCall ? `On call: ${onCall}` : 'Nobody on call'}
          />
        </Stack>

        {isAdmin && (
          <Box sx={{ mt: 2 }}>
            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
              <TextField size="small" label="New schedule name" value={newSchedule} onChange={(e) => setNewSchedule(e.target.value)} />
              <Button variant="outlined" onClick={handleCreateSchedule}>Add schedule</Button>
            </Stack>
            {activeSchedule && (
              <>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
                  <TextField size="small" label="User email" value={newShift.userEmail} onChange={(e) => setNewShift({ ...newShift, userEmail: e.target.value })} />
                  <TextField size="small" type="datetime-local" label="Starts" InputLabelProps={{ shrink: true }} value={newShift.startsAt} onChange={(e) => setNewShift({ ...newShift, startsAt: e.target.value })} />
                  <TextField size="small" type="datetime-local" label="Ends" InputLabelProps={{ shrink: true }} value={newShift.endsAt} onChange={(e) => setNewShift({ ...newShift, endsAt: e.target.value })} />
                  <Button variant="outlined" onClick={handleAddShift}>Add shift</Button>
                  <Button color="error" onClick={() => deleteSchedule(activeSchedule).then(() => { setActiveSchedule(null); loadSchedules() })}>Delete schedule</Button>
                </Stack>
                <List dense>
                  {shifts.map((sh) => (
                    <ListItem key={sh.id} secondaryAction={
                      <IconButton edge="end" onClick={() => deleteShift(sh.id).then(() => loadOnCall(activeSchedule))}><DeleteOutlineIcon /></IconButton>
                    }>
                      <ListItemText primary={sh.user_email} secondary={`${new Date(sh.starts_at).toLocaleString()} → ${new Date(sh.ends_at).toLocaleString()}`} />
                    </ListItem>
                  ))}
                </List>
              </>
            )}
          </Box>
        )}
      </Paper>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {/* Incident list */}
        <Box sx={{ flex: '1 1 380px', minWidth: 320 }}>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Report an incident</Typography>
            <Stack spacing={1}>
              <TextField size="small" label="Title" value={newIncident.title} onChange={(e) => setNewIncident({ ...newIncident, title: e.target.value })} />
              <TextField size="small" label="Description" multiline minRows={2} value={newIncident.description} onChange={(e) => setNewIncident({ ...newIncident, description: e.target.value })} />
              <TextField size="small" select label="Severity" value={newIncident.severity} onChange={(e) => setNewIncident({ ...newIncident, severity: e.target.value })}>
                {SEVERITIES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
              <Button variant="contained" onClick={handleCreate}>Open incident</Button>
            </Stack>
          </Paper>

          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <TextField size="small" select label="Status" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} sx={{ minWidth: 130 }}>
              <MenuItem value="">All</MenuItem>
              {STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <TextField size="small" select label="Severity" value={filter.severity} onChange={(e) => setFilter({ ...filter, severity: e.target.value })} sx={{ minWidth: 130 }}>
              <MenuItem value="">All</MenuItem>
              {SEVERITIES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Stack>

          {incidents.length === 0 ? (
            <EmptyState icon="🚨" title="No incidents" description="Nothing on fire right now." />
          ) : (
            <Stack spacing={1}>
              {incidents.map((inc) => (
                <Paper key={inc.id} sx={{ p: 1.5, cursor: 'pointer', outline: selected?.id === inc.id ? '2px solid var(--color-primary, #0052cc)' : 'none' }} onClick={() => openDetail(inc.id)}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" color={SEV_COLOR[inc.severity]} label={inc.severity} />
                    <Chip size="small" color={STATUS_COLOR[inc.status]} label={inc.status} />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{inc.title}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>{durationLabel(inc.started_at, inc.resolved_at)}</Typography>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>

        {/* Incident detail */}
        <Box sx={{ flex: '1 1 380px', minWidth: 320 }}>
          {selected ? (
            <Paper sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Chip size="small" color={SEV_COLOR[selected.severity]} label={selected.severity} />
                <Chip size="small" color={STATUS_COLOR[selected.status]} label={selected.status} />
                <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                  Duration {durationLabel(selected.started_at, selected.resolved_at)}
                </Typography>
              </Stack>
              <Typography variant="h6">{selected.title}</Typography>
              {selected.description && <Typography variant="body2" sx={{ mb: 2 }}>{selected.description}</Typography>}
              {selected.commander_email && <Typography variant="caption" color="text.secondary">Commander: {selected.commander_email}</Typography>}

              <Stack direction="row" spacing={1} sx={{ my: 2 }} flexWrap="wrap">
                <TextField size="small" select label="Status" value={selected.status} onChange={(e) => handleStatus(e.target.value)} sx={{ minWidth: 150 }}>
                  {STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </TextField>
                <TextField size="small" select label="Severity" value={selected.severity} onChange={(e) => handleSeverity(e.target.value)} sx={{ minWidth: 120 }}>
                  {SEVERITIES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </TextField>
              </Stack>

              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" gutterBottom>Timeline</Typography>
              <List dense>
                {(selected.timeline || []).map((t) => (
                  <ListItem key={t.id} disableGutters>
                    <ListItemText
                      primary={t.note}
                      secondary={`${t.kind}${t.actor ? ` · ${t.actor}` : ''} · ${new Date(t.created_at).toLocaleString()}`}
                    />
                  </ListItem>
                ))}
              </List>
              <Stack direction="row" spacing={1}>
                <TextField size="small" fullWidth label="Add update" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button variant="outlined" onClick={handleAddNote}>Post</Button>
              </Stack>
            </Paper>
          ) : (
            <EmptyState icon="📋" title="Select an incident" description="Choose an incident to see its timeline and controls." />
          )}
        </Box>
      </Box>
    </Box>
  )
}

export default IncidentsPage
