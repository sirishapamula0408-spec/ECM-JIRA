import { useCallback, useEffect, useRef, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import LinearProgress from '@mui/material/LinearProgress'
import { uploadDocument, formatBytes } from '../../api/documentApi'
import './DocumentUploadDialog.css'

/*
 * JL-164 — upload documents to a Space (spec section 4).
 *
 * Each file is its own request, and therefore its own progress bar and its own
 * cancel button. Batching them into one request would mean a single progress
 * figure for the whole selection and an all-or-nothing cancel — and one
 * rejected file would take the rest of the batch with it.
 *
 * The limits shown come from the SERVER's response (storage.maxFileBytes), not
 * from a constant here. MAX_DOCUMENT_SIZE_MB is configurable, and a dialog
 * that promises 100 MB while the server enforces something else is worse than
 * one that says nothing.
 */

/** One row's state machine: queued → uploading → done | error | cancelled. */
const QUEUED = 'queued'

export function DocumentUploadDialog({
  open, onClose, spaceKey, folderId = null, maxFileBytes, supportedText, onUploaded,
}) {
  const [rows, setRows] = useState([])
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  // Cancel handles, keyed by row id, so a row can be aborted mid-flight.
  const handles = useRef(new Map())

  useEffect(() => {
    if (open) {
      setRows([])
      setDescription('')
      setTags('')
      setDragging(false)
      handles.current.clear()
    }
  }, [open])

  const addFiles = useCallback((fileList) => {
    const next = [...fileList].map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      status: QUEUED,
      percent: 0,
      error: '',
    }))
    setRows((current) => [...current, ...next])
  }, [])

  function onDrop(event) {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files)
  }

  function cancelRow(id) {
    handles.current.get(id)?.cancel()
  }

  async function startUpload() {
    const pending = rows.filter((r) => r.status === QUEUED)
    for (const row of pending) {
      /*
       * Sequential, not parallel. Several 100 MB uploads at once would
       * saturate the connection and make every progress bar meaningless;
       * one at a time also keeps the server's per-Space quota check
       * meaningful, since each upload sees the previous one's bytes.
       */
      setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, status: 'uploading' } : r)))

      const handle = uploadDocument(spaceKey, row.file, {
        folderId,
        description,
        tags,
        onProgress: ({ percent }) => {
          setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, percent } : r)))
        },
      })
      handles.current.set(row.id, handle)

      try {
        const created = await handle.promise
        setRows((cur) => cur.map((r) => (
          r.id === row.id ? { ...r, status: 'done', percent: 100 } : r
        )))
        onUploaded?.(created)
      } catch (err) {
        setRows((cur) => cur.map((r) => (r.id === row.id
          ? {
            ...r,
            status: err.cancelled ? 'cancelled' : 'error',
            // The server owns every refusal's wording — size, type, quota,
            // duplicate — so it is shown as sent rather than reworded here.
            error: err.cancelled ? '' : (err.message || 'Upload failed.'),
          }
          : r)))
      } finally {
        handles.current.delete(row.id)
      }
    }
  }

  const busy = rows.some((r) => r.status === 'uploading')
  const queued = rows.filter((r) => r.status === QUEUED).length

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Upload documents</DialogTitle>
      <DialogContent>
        {/*
          * Drag handlers only — no click handler, so this needs no role or
          * key handler of its own. The Browse button beside it is the
          * keyboard route to the same file input, which is what makes the
          * drop zone an enhancement rather than the only way in.
          */}
        <div
          className={`doc-dropzone${dragging ? ' doc-dropzone--active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p className="doc-dropzone-lead">Drag files here, or</p>
          <Button variant="outlined" onClick={() => inputRef.current?.click()} disabled={busy}>
            Browse files
          </Button>
          <input
            ref={inputRef}
            id="document-upload-input"
            type="file"
            multiple
            className="doc-dropzone-input"
            onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
          />
          {/* Section 4 requires both of these stated in the UI. */}
          <p className="doc-dropzone-limits">
            Maximum file size: {maxFileBytes ? formatBytes(maxFileBytes) : '100 MB'} per file
          </p>
          <p className="doc-dropzone-limits">{supportedText}</p>
        </div>

        {rows.length > 0 && (
          <ul className="doc-upload-rows">
            {rows.map((row) => (
              <li key={row.id} className="doc-upload-row">
                <div className="doc-upload-row-head">
                  <span className="doc-upload-name" title={row.file.name}>{row.file.name}</span>
                  <span className="doc-upload-size">{formatBytes(row.file.size)}</span>
                  {row.status === 'uploading' && (
                    <Button size="small" onClick={() => cancelRow(row.id)}>Cancel</Button>
                  )}
                  {row.status === 'done' && <span className="doc-upload-state doc-upload-state--ok">Uploaded</span>}
                  {row.status === 'cancelled' && <span className="doc-upload-state">Cancelled</span>}
                </div>
                {row.status === 'uploading' && (
                  <>
                    <LinearProgress variant="determinate" value={row.percent} />
                    <span className="doc-upload-progress">
                      {row.percent}% — {formatBytes((row.file.size * row.percent) / 100)} of {formatBytes(row.file.size)}
                    </span>
                  </>
                )}
                {row.error && <Alert severity="error" sx={{ mt: 1 }}>{row.error}</Alert>}
              </li>
            ))}
          </ul>
        )}

        <TextField
          id="document-description"
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          sx={{ mt: 2 }}
          disabled={busy}
        />
        <TextField
          id="document-tags"
          label="Tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          fullWidth
          size="small"
          sx={{ mt: 2 }}
          helperText="Comma separated. Used by search."
          disabled={busy}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Close</Button>
        <Button variant="contained" onClick={startUpload} disabled={busy || queued === 0}>
          {busy ? 'Uploading…' : `Upload${queued ? ` ${queued} file${queued === 1 ? '' : 's'}` : ''}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default DocumentUploadDialog
