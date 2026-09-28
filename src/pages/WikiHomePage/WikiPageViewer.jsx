import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import { usePageTitle } from '../../hooks/usePageTitle'
import { usePermissions } from '../../hooks/usePermissions'
import { LoadingState, ErrorState } from '../../components/common/LoadingState'
import { RelativeTime } from '../../components/common/RelativeTime'
import { fetchWikiPage, updateWikiPage } from '../../api/wikiApi'
import { recordPageView } from '../../api/wikiHomeApi'
import { sanitizeHtml } from '../../utils/sanitizeHtml'
import { looksLikeHtml } from '../../utils/editorContent'
import './WikiPageViewer.css'

/*
 * JL-96→103 — the Confluence Lite page: read it, and edit it.
 *
 * ── Storage format (JL-76) ──────────────────────────────────────────────────
 *
 * Sanitised HTML, the same as an issue description. The alternative was
 * ProseMirror JSON or Markdown; HTML wins because TipTap already emits it,
 * because sanitizeHtml already gates it (JL-359 — the ONLY sanitiser in the
 * codebase), and because it makes one content pipeline serve both products
 * rather than two that drift.
 *
 * Pages written before this ticket hold plain text. `looksLikeHtml` tells the
 * two apart and legacy content keeps its whitespace instead of being rendered
 * as if it were markup — no migration, and nothing silently reflowed.
 *
 * ── Editing (JL-102 / JL-103) ───────────────────────────────────────────────
 *
 * Autosave is debounced and reports its own state, so "did that save?" is
 * answered on screen rather than by guessing. Every save carries the version
 * the editor loaded; the server refuses a save built on a superseded version
 * (409) instead of letting the later write silently discard the earlier one.
 */

// Loaded on demand: TipTap plus the table and image extensions is a large
// bundle to hand to somebody who only wants to read a page.
const TipTapEditor = lazy(() =>
  import('../../components/editor/TipTapEditor').then((m) => ({ default: m.TipTapEditor })),
)

/** How long after the last keystroke a save fires (JL-102). */
const AUTOSAVE_MS = 1500

export function WikiPageViewer() {
  const { pageId } = useParams()
  const { canCreateIssue: canEdit } = usePermissions()

  const [page, setPage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'
  const [saveState, setSaveState] = useState('idle')
  const [conflict, setConflict] = useState(null)
  // Separate from the page-LOAD error above: a failed save must not blank the
  // article, because the editor inside it holds the only copy of the text.
  const [saveError, setSaveError] = useState('')

  usePageTitle(page?.title || 'Page')

  /*
   * `latest` is the in-flight token. Without it, navigating from one page to
   * the next while the first request is open lets the slower response land
   * last and paint the page the user already left.
   */
  const latest = useRef(0)
  const timer = useRef(null)

  const load = useCallback(async () => {
    const ticket = latest.current + 1
    latest.current = ticket
    setLoading(true)
    setError('')
    try {
      const data = await fetchWikiPage(pageId)
      if (latest.current !== ticket) return
      setPage(data)
      setDraft(data.content || '')
      setSaveState('idle')
      setConflict(null)
      // Record the read AFTER it succeeded, and never block on it. The server
      // refuses views of pages the caller cannot see, so this cannot be used
      // to seed a history with pages they were never shown.
      recordPageView(pageId).catch(() => {})
    } catch (err) {
      if (latest.current !== ticket) return
      setError(err?.message || 'Could not load that page.')
    } finally {
      if (latest.current === ticket) setLoading(false)
    }
  }, [pageId])

  useEffect(() => { load() }, [load])

  // Cancel a pending autosave when the page changes or the view unmounts,
  // otherwise it fires against the page the user has already left.
  useEffect(() => () => clearTimeout(timer.current), [pageId])

  const save = useCallback(async (html) => {
    if (!page) return
    setSaveState('saving')
    setSaveError('')
    try {
      const updated = await updateWikiPage(page.id, {
        content: html,
        // JL-103: the revision this edit was written against.
        expectedVersion: page.version,
      })
      setPage((p) => ({ ...p, ...updated, version: (p.version ?? 0) + 1 }))
      setSaveState('saved')
      setConflict(null)
    } catch (err) {
      /*
       * A 409 is not a failure to save — it is a refusal, and the difference
       * matters to the reader. Their text is still in the editor; what they
       * need is to know someone else got there first and to choose what to do.
       */
      if (err?.status === 409) {
        setSaveState('conflict')
        // client.js preserves the response payload as `error.data` (not
        // `.body`) — that is where editedBy and currentVersion arrive.
        setConflict(err.data || { error: err.message })
      } else {
        /*
         * Deliberately NOT setError: that is the page-LOAD error, and the
         * article is gated on it being empty. Setting it here blanked the
         * whole page — including the editor holding the user's unsaved text —
         * on a transient save failure, which is the one moment that text is
         * the only copy in existence.
         */
        setSaveState('error')
        setSaveError(err?.message || 'Could not save the page.')
      }
    }
  }, [page])

  const onChange = useCallback((html) => {
    setDraft(html)
    setSaveState('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => save(html), AUTOSAVE_MS)
  }, [save])

  async function saveNow() {
    clearTimeout(timer.current)
    await save(draft)
  }

  function stopEditing() {
    clearTimeout(timer.current)
    setEditing(false)
  }

  /*
   * Rendered body. Sanitised here as well as on the way in — the JL-359 note
   * is explicit that content reaching dangerouslySetInnerHTML passes through
   * this module, and content stored before that rule existed has not.
   */
  const body = useMemo(() => {
    const content = page?.content || ''
    if (!content) return null
    if (!looksLikeHtml(content)) {
      // Written before pages held HTML: keep the author's line breaks rather
      // than collapsing them as markup would.
      return <pre className="wiki-content-pre">{content}</pre>
    }
    return (
      <div
        className="wiki-viewer-content"
        // Sanitised immediately above via the one sanitiser (JL-359).
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
      />
    )
  }, [page])

  const SAVE_LABEL = {
    dirty: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
    conflict: 'Not saved',
  }

  return (
    <div className="wiki-viewer">
      {loading && <LoadingState label="Loading page…" variant="skeleton" rows={6} />}
      {!loading && error && !editing && <ErrorState error={error} onRetry={load} />}

      {!loading && !error && page && (
        <article className="wiki-viewer-body">
          <header className="wiki-viewer-head">
            <h1>{page.title}</h1>
            <p className="wiki-viewer-meta">
              {page.space_name || 'No space'} · updated <RelativeTime value={page.updated_at} />
              {page.status === 'draft' && <span className="pill pill--lozenge pill-yellow">Draft</span>}
              {editing && saveState !== 'idle' && (
                <span className={`wiki-save-state wiki-save-state--${saveState}`} role="status">
                  {SAVE_LABEL[saveState]}
                </span>
              )}
            </p>
            {canEdit && (
              <div className="wiki-viewer-actions">
                {!editing && <Button size="small" variant="outlined" onClick={() => setEditing(true)}>Edit</Button>}
                {editing && (
                  <>
                    <Button size="small" variant="contained" onClick={saveNow} disabled={saveState === 'saving'}>
                      Save
                    </Button>
                    <Button size="small" onClick={stopEditing}>Done</Button>
                  </>
                )}
              </div>
            )}
          </header>

          {saveError && !conflict && (
            <Alert severity="error" className="wiki-conflict" onClose={() => setSaveError('')}>
              {saveError}
            </Alert>
          )}

          {/* JL-103: say who, and offer the only two things that help. */}
          {conflict && (
            <Alert
              severity="warning"
              className="wiki-conflict"
              action={<Button size="small" onClick={load}>Reload</Button>}
            >
              {conflict.editedBy
                ? `${conflict.editedBy} changed this page while you were editing it. Your text is still here — copy anything you need, then reload.`
                : 'This page changed while you were editing it. Your text is still here — copy anything you need, then reload.'}
            </Alert>
          )}

          {editing ? (
            <Suspense fallback={<LoadingState label="Loading editor…" variant="skeleton" rows={4} />}>
              {/* JL-98/JL-101: tables and images are on for pages and off for
                  issue descriptions, which is why they are props. */}
              <TipTapEditor
                value={draft}
                onChange={onChange}
                placeholder="Write the page… Type / for blocks"
                tables
                images
                autoFocus
              />
            </Suspense>
          ) : (
            body || <p className="wiki-viewer-empty">This page has no content yet.</p>
          )}
        </article>
      )}
    </div>
  )
}

export default WikiPageViewer
