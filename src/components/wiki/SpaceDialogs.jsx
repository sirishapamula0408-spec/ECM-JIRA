import { useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import Stack from '@mui/material/Stack'
import { createSpace, deleteSpace } from '../../api/spaceApi'

/*
 * JL-156 — the create and delete dialogs for a Space, in one module because
 * they are used from two places each: the Spaces directory page and the
 * Confluence Lite sidebar's Spaces section.
 *
 * ── Why these were extracted ────────────────────────────────────────────────
 *
 * The create form already existed, inline in SpacesPage. Adding a second one
 * behind the sidebar's "+" would have been two forms for one endpoint, free to
 * drift on field order, key casing and which server error is surfaced — the
 * same shape of problem as the two sanitisers in JL-359 and the four status
 * colours in JL-457. One form, two callers.
 *
 * Both dialogs own their own submission and report the SERVER's message on
 * failure. The rules — key shape, duplicate keys, who may delete, whether the
 * Space still holds pages — live on the server, and restating any of them here
 * would create a second copy free to disagree with the first.
 */

const EMPTY_FORM = { key: '', name: '', description: '' }

/**
 * Create a Space.
 *
 * @param {boolean}  open
 * @param {Function} onClose
 * @param {Function} onCreated  called with the created Space on success
 */
export function CreateSpaceDialog({ open, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // A reopened dialog starts clean; a half-typed key left from a cancelled
  // attempt is a trap, not a convenience.
  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM)
      setError('')
    }
  }, [open])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const created = await createSpace({
        key: form.key.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
      })
      onCreated?.(created)
      onClose?.()
    } catch (err) {
      setError(err?.message || 'Could not create the Space.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Create a Space</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              id="space-name"
              label="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              fullWidth
              autoFocus
            />
            <TextField
              id="space-key"
              label="Key"
              value={form.key}
              // Uppercased as you type so what you see is what is stored — the
              // server uppercases too, and a field that silently changes your
              // input on save is worse than one that shows the rule.
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase() }))}
              required
              fullWidth
              helperText="2–10 characters, starting with a letter. Used in URLs, like ENG."
            />
            <TextField
              id="space-description"
              label="Description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              fullWidth
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * Confirm and delete a Space.
 *
 * Deleting is irreversible and the control that opens this sits one click away
 * in a nav row, so the Space's NAME is in the prompt — "Delete this space?"
 * beside a list of eight of them is not a confirmation, it is a coin flip.
 *
 * @param {object|null} space     the Space to delete; null closes the dialog
 * @param {Function}    onClose
 * @param {Function}    onDeleted called with the deleted Space on success
 */
export function DeleteSpaceDialog({ space, onClose, onDeleted }) {
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { if (space) setError('') }, [space])

  async function handleDelete() {
    setError('')
    setSubmitting(true)
    try {
      await deleteSpace(space.id)
      onDeleted?.(space)
      onClose?.()
    } catch (err) {
      /*
       * The common failure here is the 409 for a Space that still holds
       * pages, and its message names the count and the alternative. Keep the
       * dialog OPEN so the reader can act on it — closing would leave them
       * with a toast and no idea which Space it referred to.
       */
      setError(err?.message || 'Could not delete the Space.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={Boolean(space)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete {space?.name}?</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <DialogContentText>
          This permanently deletes the Space <strong>{space?.key}</strong> and
          everyone’s membership of it. It cannot be undone. To keep the Space
          and its pages but take it out of the way, archive it instead.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button onClick={handleDelete} color="error" variant="contained" disabled={submitting}>
          {submitting ? 'Deleting…' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
