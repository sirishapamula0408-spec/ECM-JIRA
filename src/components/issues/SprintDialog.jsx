import { useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import { SPRINT_DURATIONS, todayDay, toDay, inferDuration, endForDuration } from '../../utils/sprintDates'

/**
 * JL-483 — Atlassian-style Create / Edit sprint dialog.
 *
 * Fields as in Jira: Sprint name, Duration (1–4 weeks or Custom), Start date,
 * End date (filled from the duration; editable only for Custom), Sprint goal.
 * Mount it fresh for each open (the page renders it conditionally with a key):
 * the initial values are read once, so there is no prop-to-state syncing.
 *
 * @param {'create'|'edit'} props.mode
 * @param {object}   [props.sprint]       the sprint being edited (edit mode)
 * @param {string}   [props.suggestedName] prefilled name in create mode
 * @param {Function} props.onSubmit       ({ name, startDate, endDate, goal }) => Promise
 * @param {Function} props.onClose
 */
export function SprintDialog({ mode = 'create', sprint = null, suggestedName = '', onSubmit, onClose }) {
  const editing = mode === 'edit'
  const [initial] = useState(() => {
    if (editing) {
      const start = toDay(sprint?.startDate)
      const end = toDay(sprint?.endDate)
      return { name: sprint?.name || '', start, end, duration: inferDuration(start, end), goal: sprint?.goal || '' }
    }
    const start = todayDay()
    return { name: suggestedName, start, end: endForDuration(start, '2'), duration: '2', goal: '' }
  })
  const [name, setName] = useState(initial.name)
  const [duration, setDuration] = useState(initial.duration)
  const [startDate, setStartDate] = useState(initial.start)
  const [endDate, setEndDate] = useState(initial.end)
  const [goal, setGoal] = useState(initial.goal)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const isCustom = duration === 'custom'
  const endBeforeStart = Boolean(startDate && endDate && endDate < startDate)
  const nameMissing = editing && !name.trim()
  // As in Jira, a sprint needs both dates. (An empty Custom end date used to
  // create an open-ended "From 20 Nov" sprint.)
  const startMissing = !startDate
  const endMissing = !endDate
  const invalid = endBeforeStart || nameMissing || startMissing || endMissing

  function changeDuration(next) {
    setDuration(next)
    if (next !== 'custom') setEndDate(endForDuration(startDate, next))
  }

  function changeStart(next) {
    setStartDate(next)
    if (!isCustom) setEndDate(endForDuration(next, duration))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (invalid) return
    setError('')
    setSaving(true)
    try {
      await onSubmit({ name: name.trim(), startDate: startDate || null, endDate: endDate || null, goal: goal.trim() || null })
      onClose?.()
    } catch (err) {
      setError(err?.message || 'Could not save the sprint.')
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="sprint-dialog-title">
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle id="sprint-dialog-title">{editing ? `Edit sprint: ${sprint?.name || ''}` : 'Create sprint'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField
            label="Sprint name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required={editing}
            placeholder={editing ? undefined : 'Leave blank to number it automatically'}
            error={nameMissing}
            helperText={nameMissing ? 'Sprint name is required' : ' '}
            fullWidth
            autoFocus
            sx={{ mt: 1 }}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <TextField
            select
            label="Duration"
            value={duration}
            onChange={(e) => changeDuration(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          >
            {SPRINT_DURATIONS.map((d) => <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}
          </TextField>
          {/* Wraps onto two rows on a narrow screen instead of squeezing the dates unreadable. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
            <TextField
              type="date"
              label="Start date"
              value={startDate}
              onChange={(e) => changeStart(e.target.value)}
              required
              error={startMissing}
              helperText={startMissing ? 'Choose a start date' : ' '}
              sx={{ flex: '1 1 180px' }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              type="date"
              label="End date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={!isCustom}
              required
              error={endBeforeStart || endMissing}
              helperText={endBeforeStart
                ? 'The end date must be on or after the start date'
                : endMissing ? 'Choose an end date' : (isCustom ? ' ' : 'Set by the duration')}
              sx={{ flex: '1 1 180px' }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </div>
          <TextField
            label="Sprint goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            multiline
            minRows={3}
            fullWidth
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving || invalid}>
            {saving ? 'Saving…' : (editing ? 'Update' : 'Create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
