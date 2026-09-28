import { useCallback, useEffect, useState } from 'react'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import { LoadingState, ErrorState } from '../common/LoadingState'
import { RelativeTime } from '../common/RelativeTime'
import { useConfirm } from '../common/useConfirm'
import { displayNameFromEmail } from '../../utils/helpers'
import {
  fetchWikiVersions, restoreWikiVersion, compareWikiVersions,
} from '../../api/wikiApi'
import './VersionHistoryPanel.css'

/*
 * JL-108 / JL-109 — a page's history: read it, compare two revisions, put one
 * back.
 *
 * ── Restoring is additive ───────────────────────────────────────────────────
 *
 * The server appends a new version carrying the old content rather than
 * rewinding to an earlier row. That keeps the history immutable (JL-141) and,
 * more usefully, makes the restore itself undoable — the edits being stepped
 * back over are still in the list, so restoring the wrong one is recoverable.
 * The confirm copy says so, because "restore" otherwise reads as destructive
 * and people hesitate over it.
 *
 * ── Comparing is text-level ─────────────────────────────────────────────────
 *
 * The diff is over the page's TEXT, not its markup, so it answers "what
 * changed in this runbook" rather than showing <p> tags moving. The stated
 * cost is that a purely formatting change shows as no change; the panel says
 * so outright when that happens instead of leaving an empty box that looks
 * broken.
 */

export function VersionHistoryPanel({ pageId, currentVersion, canEdit, onRestored, onClose }) {
  // useConfirm returns the dialog as well as the opener; it has to be
  // rendered or confirm() never resolves and Restore silently does nothing.
  const { confirm, confirmDialog } = useConfirm()

  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // The two ticked rows, oldest-first once compared.
  const [picked, setPicked] = useState([])
  const [diff, setDiff] = useState(null)
  const [diffError, setDiffError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setVersions(await fetchWikiVersions(pageId))
    } catch (err) {
      // Say what failed. An empty list reads as "this page has no history",
      // which is a different claim from "this did not load" (JL-248).
      setError(err?.message || 'Could not load the version history.')
    } finally {
      setLoading(false)
    }
  }, [pageId])

  useEffect(() => { load() }, [load])

  function togglePick(versionNumber) {
    setDiff(null)
    setDiffError('')
    setPicked((current) => {
      if (current.includes(versionNumber)) return current.filter((v) => v !== versionNumber)
      // Comparing three things is not a thing, so the oldest tick drops off.
      return [...current, versionNumber].slice(-2)
    })
  }

  async function runCompare() {
    const [a, b] = [...picked].sort((x, y) => x - y)
    setBusy(true)
    setDiffError('')
    try {
      setDiff(await compareWikiVersions(pageId, a, b))
    } catch (err) {
      setDiffError(err?.message || 'Could not compare those versions.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRestore(version) {
    const ok = await confirm({
      title: `Restore version ${version.version_number}?`,
      message:
        'This adds a new version with that content — it does not erase anything. '
        + 'Everything since stays in the history, so you can undo this the same way.',
      confirmLabel: 'Restore',
    })
    if (!ok) return
    setBusy(true)
    try {
      const updated = await restoreWikiVersion(pageId, version.id)
      await load()
      setPicked([])
      setDiff(null)
      onRestored?.(updated)
    } catch (err) {
      setError(err?.message || 'Could not restore that version.')
    } finally {
      setBusy(false)
    }
  }

  const noTextChange = diff && diff.summary.added === 0 && diff.summary.removed === 0

  return (
    <aside className="wiki-history" aria-label="Version history">
      {confirmDialog}

      <div className="wiki-history-head">
        <h2>Version history</h2>
        {onClose && <Button size="small" onClick={onClose}>Close</Button>}
      </div>

      {loading && <LoadingState label="Loading history…" variant="skeleton" rows={4} />}
      {!loading && error && <ErrorState error={error} onRetry={load} />}

      {!loading && !error && versions.length === 0 && (
        <p className="wiki-history-empty">No versions recorded yet.</p>
      )}

      {!loading && !error && versions.length > 0 && (
        <>
          <p className="wiki-history-hint">
            Tick two versions to compare them.
          </p>

          <ul className="wiki-history-list">
            {versions.map((v) => (
              <li
                key={v.id}
                className={`wiki-history-row${v.version_number === currentVersion ? ' wiki-history-row--current' : ''}`}
              >
                <label className="wiki-history-pick">
                  <input
                    type="checkbox"
                    checked={picked.includes(v.version_number)}
                    onChange={() => togglePick(v.version_number)}
                    aria-label={`Select version ${v.version_number} to compare`}
                  />
                </label>
                <span className="wiki-history-meta">
                  <span className="wiki-history-title">
                    v{v.version_number}
                    {v.version_number === currentVersion && (
                      <span className="pill pill--lozenge pill-green">Current</span>
                    )}
                  </span>
                  <span className="wiki-history-sub">
                    {displayNameFromEmail(v.edited_by)} · <RelativeTime value={v.created_at} />
                  </span>
                </span>
                {/* No Restore on the version the page is already on — a button
                    that does nothing but append an identical revision is just
                    a way to pad the history. */}
                {canEdit && v.version_number !== currentVersion && (
                  <Button size="small" disabled={busy} onClick={() => handleRestore(v)}>
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>

          <div className="wiki-history-actions">
            <Button
              size="small"
              variant="contained"
              disabled={picked.length !== 2 || busy}
              onClick={runCompare}
            >
              Compare selected
            </Button>
          </div>

          {diffError && <Alert severity="error" className="wiki-history-alert">{diffError}</Alert>}

          {diff && (
            <div className="wiki-history-diff">
              <h3>
                v{diff.from.versionNumber} → v{diff.to.versionNumber}
              </h3>
              <p className="wiki-history-sub">
                {diff.summary.added} added · {diff.summary.removed} removed
              </p>

              {diff.titleChanged && (
                <Alert severity="info" className="wiki-history-alert">
                  Title changed: “{diff.from.title}” → “{diff.to.title}”
                </Alert>
              )}

              {noTextChange ? (
                /* An empty diff box looks broken. Saying why it is empty is
                   the difference between a limitation and a bug. */
                <p className="wiki-history-empty">
                  No text changed between these versions. Formatting-only edits
                  are not shown — the comparison is over the page’s text.
                </p>
              ) : (
                <ol className="wiki-diff">
                  {diff.diff.map((row, i) => (
                    <li key={`${row.type}-${i}`} className={`wiki-diff-row wiki-diff-row--${row.type}`}>
                      <span className="wiki-diff-sign" aria-hidden="true">
                        {row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ' '}
                      </span>
                      {/* The sign is decorative, so the meaning is also in
                          text for anyone not seeing the colour. */}
                      <span className="wiki-diff-kind">{row.type}</span>
                      <span className="wiki-diff-text">{row.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  )
}

export default VersionHistoryPanel
