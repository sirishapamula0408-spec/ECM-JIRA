import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { PRIORITIES } from '../../constants'
import { usePermissions } from '../../hooks/usePermissions'
import {
  fetchSlaPolicies,
  createSlaPolicy,
  deleteSlaPolicy,
  fetchSlaReport,
} from '../../api/slaApi'

const STATUS_COLOR = { breached: 'error', at_risk: 'warning', ok: 'success' }

// Small coloured chip summarising an issue's SLA state.
function SlaStatusChip({ status }) {
  const label = status === 'at_risk' ? 'At risk' : status === 'breached' ? 'Breached' : 'OK'
  return <Chip size="small" color={STATUS_COLOR[status] || 'default'} label={label} />
}

function IssueRows({ rows }) {
  if (!rows.length) return null
  return rows.map((r) => (
    <TableRow key={r.id}>
      <TableCell>{r.key}</TableCell>
      <TableCell>{r.priority}</TableCell>
      <TableCell>{r.status}</TableCell>
      <TableCell align="right">{r.elapsedHours}h</TableCell>
      <TableCell align="right">{r.targetHours}h</TableCell>
      <TableCell align="right">{r.percent}%</TableCell>
      <TableCell><SlaStatusChip status={r.slaStatus} /></TableCell>
    </TableRow>
  ))
}

export function SlaPanel({ projectId }) {
  const { isAdmin } = usePermissions(projectId ? Number(projectId) : undefined)
  const [report, setReport] = useState(null)
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // New-policy form state
  const [priority, setPriority] = useState('High')
  const [targetHours, setTargetHours] = useState('')
  const [saving, setSaving] = useState(false)

  const numericProjectId = projectId ? Number(projectId) : null

  const load = useCallback(() => {
    if (!numericProjectId) return
    setLoading(true)
    setError(null)
    Promise.all([fetchSlaReport(numericProjectId), fetchSlaPolicies(numericProjectId)])
      .then(([rep, pol]) => {
        setReport(rep)
        setPolicies(Array.isArray(pol) ? pol : [])
      })
      .catch((e) => setError(e?.message || 'Failed to load SLA data'))
      .finally(() => setLoading(false))
  }, [numericProjectId])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    const hours = Number(targetHours)
    if (!Number.isFinite(hours) || hours <= 0) {
      setError('Target hours must be a positive number')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createSlaPolicy({ projectId: numericProjectId, priority, targetHours: hours })
      setTargetHours('')
      load()
    } catch (e) {
      setError(e?.message || 'Failed to create policy')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await deleteSlaPolicy(id)
      load()
    } catch (e) {
      setError(e?.message || 'Failed to delete policy')
    }
  }

  if (!numericProjectId) {
    return (
      <article className="panel chart-placeholder">
        <div className="reports-panel-header"><h3>SLA Tracking</h3></div>
        <div className="fake-chart">Select a project to view SLA tracking.</div>
      </article>
    )
  }

  const summary = report?.summary || { breached: 0, atRisk: 0, ok: 0, noPolicy: 0, total: 0 }
  const breached = report?.breached || []
  const atRisk = report?.atRisk || []

  return (
    <article className="panel chart-placeholder sla-panel">
      <div className="reports-panel-header">
        <h3>SLA Tracking &amp; Alerts</h3>
      </div>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Chip color="error" label={`Breached: ${summary.breached}`} />
        <Chip color="warning" label={`At risk: ${summary.atRisk}`} />
        <Chip color="success" label={`OK: ${summary.ok}`} />
        <Chip variant="outlined" label={`No policy: ${summary.noPolicy}`} />
      </Stack>

      {loading && <div className="fake-chart">Loading SLA data…</div>}

      {!loading && (breached.length > 0 || atRisk.length > 0) && (
        <Table size="small" sx={{ mb: 2 }}>
          <TableHead>
            <TableRow>
              <TableCell>Issue</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Elapsed</TableCell>
              <TableCell align="right">Target</TableCell>
              <TableCell align="right">Used</TableCell>
              <TableCell>SLA</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <IssueRows rows={breached} />
            <IssueRows rows={atRisk} />
          </TableBody>
        </Table>
      )}

      {!loading && breached.length === 0 && atRisk.length === 0 && (
        <div className="fake-chart">No issues are breached or at risk.</div>
      )}

      {/* Policy editor — Admin only */}
      {isAdmin && (
        <div className="sla-policy-editor">
          <h4>SLA Policies</h4>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Priority</TableCell>
                <TableCell align="right">Target (hours)</TableCell>
                <TableCell>Applies to</TableCell>
                <TableCell align="right"></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {policies.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.priority}</TableCell>
                  <TableCell align="right">{p.target_hours}</TableCell>
                  <TableCell>{p.applies_to}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" aria-label="Delete policy" onClick={() => handleDelete(p.id)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {policies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center">No policies defined yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center" flexWrap="wrap">
            <TextField
              select
              size="small"
              label="Priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              sx={{ minWidth: 120 }}
            >
              {PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
            <TextField
              size="small"
              type="number"
              label="Target hours"
              value={targetHours}
              onChange={(e) => setTargetHours(e.target.value)}
              sx={{ width: 140 }}
            />
            <Button variant="contained" onClick={handleCreate} disabled={saving}>
              Add policy
            </Button>
          </Stack>
        </div>
      )}
    </article>
  )
}
