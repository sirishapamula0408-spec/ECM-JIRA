import { useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import { createFolder, updateFolder, deleteFolder, updateDocument } from '../../api/documentApi'

/*
 * JL-169/JL-170 — the folder dialogs (spec section 7).
 *
 * All three surface the SERVER's message on failure rather than restating its
 * rules. The rules worth not duplicating here:
 *
 *   - a duplicate folder name in the same parent is a 409
 *   - deleting a folder that still holds documents is a 409 naming the count,
 *     the same refusal shape as deleting a Space that still holds pages
 *     (JL-156) and for the same reason: the alternative is silently orphaning
 *     content
 *   - moving is Admin-only, and the target folder must belong to the same
 *     Space — otherwise a move would be a way to push a document across a
 *     Space boundary
 */

/** Create a folder, or rename one. `folder` null means create. */
export function FolderFormDialog({ open, spaceKey, folder, parentFolderId, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(folder?.folder_name || '')
    setError('')
  }, [open, folder])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      if (folder) await updateFolder(folder.id, { folderName: name.trim() })
      else await createFolder(spaceKey, { folderName: name.trim(), parentFolderId })
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err?.message || 'Could not save the folder.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>{folder ? 'Rename folder' : 'New folder'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField
            id="folder-name"
            label="Folder name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
            autoFocus
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : (folder ? 'Rename' : 'Create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** Confirm deleting a folder. */
export function DeleteFolderDialog({ folder, onClose, onDeleted }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (folder) setError('') }, [folder])

  async function handleDelete() {
    setError('')
    setBusy(true)
    try {
      await deleteFolder(folder.id)
      onDeleted?.()
      onClose?.()
    } catch (err) {
      /*
       * The common failure is the 409 for a folder that still holds
       * documents, and its message names the count. Keep the dialog open so
       * the reader can act on it — closing would leave a message with no
       * indication of which folder it referred to.
       */
      setError(err?.message || 'Could not delete the folder.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(folder)} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete {folder?.folder_name}?</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <DialogContentText>
          The folder is removed. Documents inside it are not deleted — move
          them out first, or the folder cannot be removed.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={handleDelete} color="error" variant="contained" disabled={busy}>
          {busy ? 'Deleting…' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** Move one document into a folder, or out of all of them. */
export function MoveDocumentDialog({ document: doc, folders, onClose, onMoved }) {
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!doc) return
    setTarget(doc.folder_id ? String(doc.folder_id) : '')
    setError('')
  }, [doc])

  async function handleMove() {
    setError('')
    setBusy(true)
    try {
      // '' means "not filed": the column is nullable, and a document that
      // belongs to no folder is a valid state rather than an error.
      await updateDocument(doc.id, { folderId: target ? Number(target) : null })
      onMoved?.()
      onClose?.()
    } catch (err) {
      setError(err?.message || 'Could not move that document.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(doc)} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Move {doc?.file_name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          id="move-target-folder"
          select
          label="Destination"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          fullWidth
          sx={{ mt: 1 }}
        >
          <MenuItem value="">Not filed</MenuItem>
          {folders.map((f) => (
            <MenuItem key={f.id} value={String(f.id)}>{f.path || f.folder_name}</MenuItem>
          ))}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={handleMove} variant="contained" disabled={busy}>
          {busy ? 'Moving…' : 'Move'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
