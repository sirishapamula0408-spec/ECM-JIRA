import { useCallback, useEffect, useRef, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import TextField from '@mui/material/TextField'
import LinearProgress from '@mui/material/LinearProgress'
import { LoadingState } from '../common/LoadingState'
import { RelativeTime } from '../common/RelativeTime'
import {
  fetchDocumentVersions, restoreDocumentVersion, replaceDocument,
  documentDownloadUrl, formatBytes,
} from '../../api/documentApi'
import './DocumentVersionsDialog.css'

/*
 * JL-169/JL-170 — version history for one document (spec section 10).
 *
 * ── Restore appends, it does not rewind ─────────────────────────────────────
 *
 * The server implements restore as a NEW version carrying the old bytes, the
 * same shape as the wiki's JL-108 page restore. That is deliberate and the
 * dialog says so out loud, because "restore" reads like an undo and a reader
 * who expects the newer versions to disappear would be surprised by a history
 * that only ever grows. Nothing is lost, which is the point.
 *
 * ── Replace lives here too ──────────────────────────────────────────────────
 *
 * Uploading a replacement is what CREATES a version, so putting it anywhere
 * else would leave this dialog permanently showing a single row with no way to
 * reach a second. The change comment is captured at the moment of replacing,
 * which is the only moment anyone knows what changed.
 */

export function DocumentVersionsDialog({
  document: doc, canRestore, canReplace, onClose, onChanged, onDownload,
}) {
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [comment, setComment] = useState('')
  const [progress, setProgress] = useState(null)
  const fileRef = useRef(null)
  const cancelRef = useRef(null)

  const open = Boolean(doc)

  const load = useCallback(async () => {
    if (!doc) return
    setLoading(true)
    setError('')
    try {
      const rows = await fetchDocumentVersions(doc.id)
      setVersions(Array.isArray(rows) ? rows : rows?.items ?? [])
    } catch (err) {
      setError(err?.message || 'Could not load the version history.')
    } finally {
      setLoading(false)
    }
  }, [doc])

  useEffect(() => {
    if (!open) return
    setComment('')
    setProgress(null)
    load()
  }, [open, load])

  // An upload in flight when the dialog closes would keep reporting progress
  // into unmounted state, and the bytes are no longer wanted either.
  useEffect(() => () => { cancelRef.current?.() }, [])

  async function handleRestore(version) {
    setError('')
    setBusy(true)
    try {
      await restoreDocumentVersion(doc.id, version.id)
      await load()
      onChanged?.()
    } catch (err) {
      setError(err?.message || 'Could not restore that version.')
    } finally {
      setBusy(false)
    }
  }

  async function handleReplace(file) {
    if (!file) return
    setError('')
    setBusy(true)
    setProgress({ percent: 0, loaded: 0, total: file.size })
    try {
      // replaceDocument returns { promise, cancel } — NOT a promise. Awaiting
      // the object itself resolves immediately and the upload would look
      // instantaneous while still running.
      const { promise, cancel } = replaceDocument(doc.id, file, {
        changeComment: comment.trim(),
        onProgress: setProgress,
      })
      cancelRef.current = cancel
      await promise
      setComment('')
      await load()
      onChanged?.()
    } catch (err) {
      setError(err?.message || 'Could not upload the replacement.')
    } finally {
      cancelRef.current = null
      setProgress(null)
      setBusy(false)
      // Clearing the input matters: picking the same file twice in a row fires
      // no change event otherwise, and the second attempt looks ignored.
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const current = doc?.current_version

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Version history — {doc?.file_name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading && <LoadingState label="Loading versions…" />}

        {!loading && versions.length === 0 && (
          <p className="doc-versions-empty">
            No earlier versions yet. Replacing this document keeps the current
            file and adds a new version on top.
          </p>
        )}

        {!loading && versions.length > 0 && (
          <div className="doc-versions-wrap">
            <table className="doc-versions-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Uploaded by</th>
                  <th>When</th>
                  <th>Size</th>
                  <th>Comment</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => {
                  const isCurrent = v.version_number === current
                  return (
                    <tr key={v.id} className={isCurrent ? 'doc-versions-current' : undefined}>
                      <td>
                        v{v.version_number}
                        {isCurrent && <span className="pill pill--lozenge pill-green">Current</span>}
                      </td>
                      <td>{v.uploaded_by}</td>
                      <td><RelativeTime value={v.uploaded_at} /></td>
                      <td>{formatBytes(v.file_size)}</td>
                      <td className="doc-versions-comment">{v.change_comment || '—'}</td>
                      <td className="doc-versions-actions">
                        {/*
                          * Downloads go through the parent's authenticated
                          * fetch: the endpoint needs a bearer token, so a
                          * plain href would arrive unauthenticated, and
                          * putting the token in the URL would write a
                          * credential into history and the server log.
                          */}
                        <Button
                          size="small"
                          disabled={busy}
                          aria-label={`Download version ${v.version_number}`}
                          onClick={() => onDownload?.(
                            documentDownloadUrl(doc.id, v.id),
                            `v${v.version_number}-${doc.file_name}`,
                          )}
                        >
                          Download
                        </Button>
                        {canRestore && !isCurrent && (
                          <Button
                            size="small"
                            disabled={busy}
                            aria-label={`Restore version ${v.version_number}`}
                            onClick={() => handleRestore(v)}
                          >
                            Restore
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {canRestore && versions.length > 1 && (
          <p className="doc-versions-note">
            Restoring adds the chosen file back as a new version. Nothing is
            deleted, so the history only ever grows.
          </p>
        )}

        {canReplace && (
          <div className="doc-versions-replace">
            <h3>Upload a new version</h3>
            <TextField
              id="doc-version-comment"
              label="What changed?"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              fullWidth
              size="small"
              disabled={busy}
              helperText="Optional, but it is the only record of why this version exists."
            />
            <input
              ref={fileRef}
              id="doc-version-file"
              type="file"
              className="doc-versions-file"
              disabled={busy}
              onChange={(e) => handleReplace(e.target.files?.[0])}
            />
            {progress && (
              <div className="doc-versions-progress">
                <LinearProgress variant="determinate" value={progress.percent ?? 0} />
                <span>
                  {progress.percent ?? 0}% — {formatBytes(progress.loaded)} of {formatBytes(progress.total)}
                </span>
                <Button size="small" onClick={() => cancelRef.current?.()}>Cancel</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

export default DocumentVersionsDialog
