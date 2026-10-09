import { useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Alert from '@mui/material/Alert'
import Stack from '@mui/material/Stack'
import { fetchSpacePages } from '../../api/wikiApi'

/*
 * JL-187 (fosasoft) — "Publish…": confirm the title and where the page goes.
 *
 * The parent list is the chosen Space's live pages, minus this page itself;
 * the server re-checks the parent (same Space, no cycle) regardless.
 */
export function PublishDialog({ open, publishing, onCancel, ...rest }) {
  return (
    <Dialog open={open} onClose={publishing ? undefined : onCancel} fullWidth maxWidth="xs" aria-labelledby="pe-publish-title">
      {/* Mounted only while open, so every opening starts from the editor's
          current title and placement. */}
      {open && <PublishForm publishing={publishing} onCancel={onCancel} {...rest} />}
    </Dialog>
  )
}

function PublishForm({ pageId, initialTitle, initialSpaceId, initialParentId, spaces, publishing, error, onCancel, onConfirm }) {
  const [title, setTitle] = useState(initialTitle || '')
  const [spaceId, setSpaceId] = useState(initialSpaceId ? String(initialSpaceId) : '')
  const [parentId, setParentId] = useState(initialParentId ? String(initialParentId) : '')
  // Tagged with the Space they came from, so a switch never shows stale pages.
  const [loaded, setLoaded] = useState({ spaceId: '', rows: [] })
  const pages = loaded.spaceId === spaceId ? loaded.rows : []

  useEffect(() => {
    if (!spaceId) return undefined
    let cancelled = false
    fetchSpacePages(spaceId)
      .then((rows) => {
        if (cancelled) return
        setLoaded({
          spaceId,
          rows: (Array.isArray(rows) ? rows : []).filter((p) => p.id !== pageId && p.status !== 'draft'),
        })
      })
      .catch(() => { if (!cancelled) setLoaded({ spaceId, rows: [] }) })
    return () => { cancelled = true }
  }, [spaceId, pageId])

  function changeSpace(value) {
    setSpaceId(value)
    // A parent from another Space is not a valid parent here.
    setParentId('')
  }

  function submit(event) {
    event.preventDefault()
    onConfirm({
      title: title.trim(),
      spaceId: spaceId ? Number(spaceId) : null,
      parentId: parentId ? Number(parentId) : null,
    })
  }

  return (
    <form onSubmit={submit}>
      <DialogTitle id="pe-publish-title">Publish page</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
            autoFocus
            slotProps={{ htmlInput: { 'data-testid': 'publish-title' } }}
          />
          <TextField select label="Space" value={spaceId} onChange={(e) => changeSpace(e.target.value)} required fullWidth>
            {spaces.map((s) => <MenuItem key={s.id} value={String(s.id)}>{s.name}</MenuItem>)}
          </TextField>
          <TextField select label="Parent page" value={parentId} onChange={(e) => setParentId(e.target.value)} fullWidth>
            <MenuItem value="">None (top level of the space)</MenuItem>
            {pages.map((p) => <MenuItem key={p.id} value={String(p.id)}>{p.title || 'Untitled'}</MenuItem>)}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={publishing}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={publishing || !title.trim() || !spaceId}>
          {publishing ? 'Publishing…' : 'Publish'}
        </Button>
      </DialogActions>
    </form>
  )
}

export default PublishDialog
