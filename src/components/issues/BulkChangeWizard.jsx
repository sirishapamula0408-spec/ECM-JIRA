import { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stepper,
  Step,
  StepLabel,
  Box,
  Typography,
  TextField,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material'
import { ISSUE_STATUSES, PRIORITIES } from '../../constants'
import { bulkChangeIssues } from '../../api/issueApi'

const STEPS = ['Selection', 'Operations', 'Preview', 'Apply']

const NO_CHANGE = '__no_change__'

// JL-121: multi-step bulk change wizard.
// Props:
//   open, onClose, issueIds:[], members:[], sprints:[], onApplied?(summary)
export function BulkChangeWizard({ open, onClose, issueIds = [], members = [], sprints = [], onApplied }) {
  const [activeStep, setActiveStep] = useState(0)
  const [status, setStatus] = useState(NO_CHANGE)
  const [priority, setPriority] = useState(NO_CHANGE)
  const [assignee, setAssignee] = useState(NO_CHANGE)
  const [sprintId, setSprintId] = useState(NO_CHANGE)
  const [addLabels, setAddLabels] = useState('')
  const [doDelete, setDoDelete] = useState(false)
  const [preview, setPreview] = useState([])
  const [summary, setSummary] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function buildOperations() {
    if (doDelete) return { delete: true }
    const ops = {}
    if (status !== NO_CHANGE) ops.status = status
    if (priority !== NO_CHANGE) ops.priority = priority
    if (assignee !== NO_CHANGE) ops.assignee = assignee
    if (sprintId !== NO_CHANGE) ops.sprintId = sprintId === '' ? null : Number(sprintId)
    const labels = addLabels.split(',').map((l) => l.trim()).filter(Boolean)
    if (labels.length > 0) ops.addLabels = labels
    return ops
  }

  const operations = buildOperations()
  const hasOperation = doDelete || Object.keys(operations).length > 0

  function reset() {
    setActiveStep(0)
    setStatus(NO_CHANGE)
    setPriority(NO_CHANGE)
    setAssignee(NO_CHANGE)
    setSprintId(NO_CHANGE)
    setAddLabels('')
    setDoDelete(false)
    setPreview([])
    setSummary(null)
    setError('')
    setBusy(false)
  }

  function handleClose() {
    reset()
    onClose?.()
  }

  async function goToPreview() {
    setBusy(true)
    setError('')
    try {
      const res = await bulkChangeIssues({ issueIds, operations, dryRun: true })
      setPreview(res.preview || [])
      setActiveStep(2)
    } catch (err) {
      setError(err?.message || 'Failed to build preview')
    } finally {
      setBusy(false)
    }
  }

  async function applyChanges() {
    setBusy(true)
    setError('')
    try {
      const res = await bulkChangeIssues({ issueIds, operations, dryRun: false })
      setSummary(res)
      setActiveStep(3)
      onApplied?.(res)
    } catch (err) {
      setError(err?.message || 'Failed to apply changes')
    } finally {
      setBusy(false)
    }
  }

  const changedCount = preview.filter((p) => p.willChange && !p.error).length
  const errorCount = preview.filter((p) => p.error).length

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Advanced bulk change</DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {activeStep === 0 && (
          <Box>
            <Typography variant="body1">
              <strong>{issueIds.length}</strong> issue{issueIds.length === 1 ? '' : 's'} selected for bulk change.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Continue to choose the operations to apply to these issues.
            </Typography>
          </Box>
        )}

        {activeStep === 1 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControlLabel
              control={<Checkbox checked={doDelete} onChange={(e) => setDoDelete(e.target.checked)} />}
              label="Delete selected issues"
            />
            {!doDelete && (
              <>
                <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} size="small" fullWidth>
                  <MenuItem value={NO_CHANGE}>No change</MenuItem>
                  {ISSUE_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </TextField>
                <TextField select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} size="small" fullWidth>
                  <MenuItem value={NO_CHANGE}>No change</MenuItem>
                  {PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                </TextField>
                <TextField select label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} size="small" fullWidth>
                  <MenuItem value={NO_CHANGE}>No change</MenuItem>
                  {members.map((m) => <MenuItem key={m.id} value={m.name}>{m.name}</MenuItem>)}
                </TextField>
                <TextField select label="Sprint" value={sprintId} onChange={(e) => setSprintId(e.target.value)} size="small" fullWidth>
                  <MenuItem value={NO_CHANGE}>No change</MenuItem>
                  <MenuItem value="">Backlog (no sprint)</MenuItem>
                  {sprints.map((s) => <MenuItem key={s.id} value={String(s.id)}>{s.name}</MenuItem>)}
                </TextField>
                <TextField label="Add labels (comma separated)" value={addLabels} onChange={(e) => setAddLabels(e.target.value)} size="small" fullWidth placeholder="frontend, urgent" />
              </>
            )}
          </Box>
        )}

        {activeStep === 2 && (
          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {changedCount} issue{changedCount === 1 ? '' : 's'} will change{errorCount > 0 ? `, ${errorCount} with errors` : ''}.
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Issue</TableCell>
                    <TableCell>Changes</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {preview.map((row) => (
                    <TableRow key={row.issueId}>
                      <TableCell>{row.key || `#${row.issueId}`}</TableCell>
                      <TableCell>
                        {row.delete ? (
                          <Chip size="small" color="error" label="Delete" />
                        ) : row.changes.length === 0 ? (
                          <Typography variant="caption" color="text.secondary">No change</Typography>
                        ) : (
                          row.changes.map((c) => (
                            <Chip key={c.field} size="small" sx={{ mr: 0.5, mb: 0.5 }} label={`${c.field}: ${fmt(c.from)} → ${fmt(c.to)}`} />
                          ))
                        )}
                      </TableCell>
                      <TableCell>
                        {row.error ? <Chip size="small" color="error" label={row.error} />
                          : row.willChange ? <Chip size="small" color="primary" label="Will change" />
                          : <Chip size="small" label="No-op" />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Box>
        )}

        {activeStep === 3 && summary && (
          <Box>
            <Alert severity={summary.errors?.length ? 'warning' : 'success'} sx={{ mb: 2 }}>
              {summary.updated} updated, {summary.skipped} skipped
              {summary.errors?.length ? `, ${summary.errors.length} error(s)` : ''}.
            </Alert>
            {summary.errors?.length > 0 && (
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Issue</TableCell><TableCell>Error</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {summary.errors.map((e) => (
                    <TableRow key={e.issueId}><TableCell>#{e.issueId}</TableCell><TableCell>{e.error}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{activeStep === 3 ? 'Close' : 'Cancel'}</Button>
        {activeStep === 0 && (
          <Button variant="contained" onClick={() => setActiveStep(1)} disabled={issueIds.length === 0}>Next</Button>
        )}
        {activeStep === 1 && (
          <Button variant="contained" onClick={goToPreview} disabled={!hasOperation || busy}>
            {busy ? <CircularProgress size={20} /> : 'Preview'}
          </Button>
        )}
        {activeStep === 2 && (
          <>
            <Button onClick={() => setActiveStep(1)} disabled={busy}>Back</Button>
            <Button variant="contained" color={operations.delete ? 'error' : 'primary'} onClick={applyChanges} disabled={busy || (changedCount === 0)}>
              {busy ? <CircularProgress size={20} /> : `Apply${changedCount ? ` (${changedCount})` : ''}`}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}

function fmt(v) {
  if (v === null || v === undefined || v === '') return '∅'
  if (Array.isArray(v)) return v.join(', ') || '∅'
  return String(v)
}
