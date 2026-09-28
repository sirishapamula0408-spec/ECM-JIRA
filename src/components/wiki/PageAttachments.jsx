import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@mui/material/Button'
import { LoadingState, ErrorState } from '../common/LoadingState'
import { RelativeTime } from '../common/RelativeTime'
import { useConfirm } from '../common/useConfirm'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../hooks/usePermissions'
import { displayNameFromEmail } from '../../utils/helpers'
import {
  fetchPageAttachments, uploadPageAttachment, deletePageAttachment,
  downloadPageAttachment, fileToBase64,
} from '../../api/wikiAttachmentApi'
import './PageAttachments.css'

/*
 * JL-120→124 — files attached to a page.
 *
 * ── Downloads go through the API, never straight to storage ─────────────────
 *
 * The endpoint needs a Bearer header, which an <a href> cannot send, so a
 * click fetches the bytes and hands the browser a blob. That is not a
 * workaround — it is the point: a URL the object store would serve directly
 * is a capability that outlives the permission that granted it, and the
 * server re-checks the page's visibility on every download.
 *
 * ── The UI decides nothing that matters ─────────────────────────────────────
 *
 * The server owns type, size and who may delete. The checks below only decide
 * which controls are worth showing; each mirrors a server rule rather than
 * standing in for one.
 */

/** Human size. Bytes are what the server stores; nobody reads in bytes. */
function formatSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function PageAttachments({ pageId }) {
  const { authUser } = useAuth()
  const { canCreateIssue: canUpload, isAdmin } = usePermissions()
  const { confirm, confirmDialog } = useConfirm()
  const inputRef = useRef(null)

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await fetchPageAttachments(pageId))
    } catch (err) {
      // Say what failed — an empty list is the claim "nothing is attached",
      // which is a different statement (JL-248).
      setError(err?.message || 'Could not load the attachments.')
    } finally {
      setLoading(false)
    }
  }, [pageId])

  useEffect(() => { load() }, [load])

  async function upload(event) {
    const file = event.target.files?.[0]
    // Reset immediately so picking the SAME file twice still fires a change.
    event.target.value = ''
    if (!file) return

    setBusy(true)
    setError('')
    try {
      const data = await fileToBase64(file)
      await uploadPageAttachment(pageId, { filename: file.name, mimeType: file.type, data })
      await load()
    } catch (err) {
      /*
       * The server's message is used verbatim: it names the actual limit and
       * the actual allow-list, and restating either here would give two
       * answers to "why was this refused" that could drift apart.
       */
      setError(err?.message || 'Could not upload that file.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(row) {
    const ok = await confirm({
      title: `Delete ${row.filename}?`,
      message: 'The file is removed from the page and from storage. This cannot be undone.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      await deletePageAttachment(pageId, row.id)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete that file.')
    }
  }

  async function download(row) {
    setError('')
    try {
      await downloadPageAttachment(pageId, row.id, row.filename)
    } catch (err) {
      setError(err?.message || 'Could not download that file.')
    }
  }

  const mine = (row) =>
    String(row.uploaded_by || '').toLowerCase() === String(authUser?.email || '').toLowerCase()

  return (
    <section className="wiki-attachments" aria-labelledby="wiki-attachments-heading">
      {confirmDialog}

      <div className="wiki-attachments-head">
        <h2 id="wiki-attachments-heading">
          Attachments{items.length > 0 && <span className="wiki-attachments-count"> ({items.length})</span>}
        </h2>
        {canUpload && (
          <>
            <Button size="small" variant="outlined" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? 'Uploading…' : 'Attach a file'}
            </Button>
            {/* The real control is the button; this stays out of the tab order
                so keyboard users are not sent through a hidden input. */}
            <input
              ref={inputRef}
              id="wiki-attachment-file"
              type="file"
              className="wiki-attachments-input"
              tabIndex={-1}
              aria-hidden="true"
              onChange={upload}
            />
          </>
        )}
      </div>

      {loading && <LoadingState label="Loading attachments…" variant="skeleton" rows={2} />}
      {!loading && error && <ErrorState error={error} onRetry={load} />}

      {!loading && !error && items.length === 0 && (
        <p className="wiki-attachments-empty">Nothing attached yet.</p>
      )}

      {!loading && items.length > 0 && (
        <ul className="wiki-attachments-list">
          {items.map((row) => (
            <li key={row.id} className="wiki-attachment">
              <button type="button" className="wiki-attachment-name" onClick={() => download(row)}>
                {row.filename}
              </button>
              <span className="wiki-attachment-meta">
                {formatSize(row.size_bytes)} · {displayNameFromEmail(row.uploaded_by)}
                {' · '}
                <RelativeTime value={row.created_at} />
              </span>
              {/* Mirrors the server: uploader OR workspace admin. */}
              {(mine(row) || isAdmin) && (
                <button type="button" className="wiki-attachment-delete" onClick={() => remove(row)}>
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default PageAttachments
