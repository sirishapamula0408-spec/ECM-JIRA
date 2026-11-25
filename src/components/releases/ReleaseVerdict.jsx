import { useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import { submitReleaseVerdict } from '../../api/releaseApi'
import './ReleaseVerdict.css'

/**
 * JL-489 — the Release Monitor's Pass / Fail on one work item in Release.
 *
 * Pass moves it to Done (the server refuses until its release is Released).
 * Fail asks why, moves it back to the status it had before Release, and can
 * re-plan it for a later, unreleased release.
 *
 * Shown only to canVerifyRelease (Release Monitor, project Lead/Admin,
 * workspace Admin/Owner); the server enforces the same rule.
 *
 * @param {object}   props.issue      { id, key } — key may be absent
 * @param {Array}    props.releases   the project's releases [{ id, name, status }]
 * @param {Function} props.onDone     (result) => void, after a verdict is saved
 * @param {boolean} [props.compact]   inline buttons only (Releases page rows)
 */
export function ReleaseVerdict({ issue, releases = [], onDone, compact = false }) {
  const [failOpen, setFailOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function pass() {
    setBusy(true); setError('')
    try {
      onDone?.(await submitReleaseVerdict(issue.id, { verdict: 'pass' }))
    } catch (err) {
      setError(err?.message || 'Could not save the verdict')
    } finally {
      setBusy(false)
    }
  }

  const buttons = (
    <div className="rv-actions">
      <Button size="small" variant="contained" color="success" onClick={pass} disabled={busy}
        aria-label={compact && issue.key ? `Pass ${issue.key}` : undefined}>
        Pass
      </Button>
      <Button size="small" variant="outlined" color="error" onClick={() => { setError(''); setFailOpen(true) }} disabled={busy}
        aria-label={compact && issue.key ? `Fail ${issue.key}` : undefined}>
        Fail
      </Button>
    </div>
  )

  return (
    <>
      {compact ? buttons : (
        <section className="rv-panel" aria-label="Release verification">
          <h3 className="rv-title">Release verification</h3>
          <p className="rv-text">Check this work item in the released build. Pass moves it to Done; Fail moves it back to its previous status.</p>
          {buttons}
        </section>
      )}
      {error && !failOpen && <p className="rv-error" role="alert">{error}</p>}
      {failOpen && (
        <FailDialog
          issue={issue}
          releases={releases.filter((r) => r.status !== 'released')}
          onClose={() => setFailOpen(false)}
          onSaved={(result) => { setFailOpen(false); onDone?.(result) }}
        />
      )}
    </>
  )
}

function FailDialog({ issue, releases, onClose, onSaved }) {
  const [reason, setReason] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const missing = touched && !reason.trim()

  async function handleSubmit(e) {
    e.preventDefault()
    setTouched(true)
    if (!reason.trim()) return
    setSaving(true); setError('')
    try {
      onSaved(await submitReleaseVerdict(issue.id, {
        verdict: 'fail',
        reason: reason.trim(),
        moveToReleaseId: moveTo === '' ? null : Number(moveTo),
      }))
    } catch (err) {
      setError(err?.message || 'Could not save the verdict')
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="rv-fail-title">
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle id="rv-fail-title">Fail {issue.key || 'work item'} in release</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField
            label="What failed?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            required
            error={missing}
            helperText={missing ? 'Say why it failed' : 'Saved as a comment. The work item moves back to its previous status.'}
            multiline
            minRows={3}
            fullWidth
            autoFocus
            sx={{ mt: 1 }}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <TextField
            select
            label="Re-plan for release (optional)"
            value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}
            fullWidth
            sx={{ mt: 2 }}
            helperText={releases.length ? 'Moves its Fix Version to a later release.' : 'No unreleased release to move it to.'}
            disabled={!releases.length}
          >
            <MenuItem value="">Keep current Fix Version</MenuItem>
            {releases.map((r) => <MenuItem key={r.id} value={String(r.id)}>{r.name}</MenuItem>)}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" color="error" disabled={saving}>
            {saving ? 'Saving…' : 'Fail and move back'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
