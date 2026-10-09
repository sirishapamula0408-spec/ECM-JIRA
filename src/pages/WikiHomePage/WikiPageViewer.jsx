import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link, useNavigate, useOutletContext } from 'react-router-dom'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import Alert from '@mui/material/Alert'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { usePageTitle } from '../../hooks/usePageTitle'
import { usePermissions } from '../../hooks/usePermissions'
import { LoadingState, ErrorState } from '../../components/common/LoadingState'
import { RelativeTime } from '../../components/common/RelativeTime'
import { fetchWikiPage } from '../../api/wikiApi'
import { recordPageView } from '../../api/wikiHomeApi'
import { sanitizeHtml } from '../../utils/sanitizeHtml'
import { looksLikeHtml } from '../../utils/editorContent'
import { VersionHistoryPanel } from '../../components/wiki/VersionHistoryPanel'
import { PageComments } from '../../components/wiki/PageComments'
import { PageAttachments } from '../../components/wiki/PageAttachments'
import { useAuthedImages } from '../../hooks/useAuthedImages'
import { fillTablesOfContents } from '../../utils/tableOfContents'
import { useTrashPage } from '../../components/wiki/useTrashPage'
import '../../components/editor/pageContent.css'
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
 * ── Editing (JL-187) ────────────────────────────────────────────────────────
 *
 * Edit opens the full-page editor at /wiki/pages/:id/edit (WikiPageEditor).
 * Editing used to happen inline here and saved straight to the live page;
 * the editor now autosaves into a draft and only Publish changes what
 * readers see.
 */

export function WikiPageViewer() {
  const { pageId } = useParams()
  const { canCreateIssue: canEdit } = usePermissions()

  const [page, setPage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const navigate = useNavigate()
  const [showHistory, setShowHistory] = useState(false)
  // JL-188: "More actions" → Move to trash.
  const { reloadHome } = useOutletContext() ?? {}
  const [moreAnchor, setMoreAnchor] = useState(null)
  const { trashPage, trashDialog, trashError, clearTrashError } = useTrashPage({ reloadHome })

  usePageTitle(page?.title || 'Page')

  /*
   * `latest` is the in-flight token. Without it, navigating from one page to
   * the next while the first request is open lets the slower response land
   * last and paint the page the user already left.
   */
  const latest = useRef(0)
  // JL-101: the rendered body, so uploaded images can be hydrated into blob
  // URLs an <img> can actually load (see useAuthedImages).
  const bodyRef = useRef(null)

  const load = useCallback(async () => {
    const ticket = latest.current + 1
    latest.current = ticket
    setLoading(true)
    setError('')
    try {
      const data = await fetchWikiPage(pageId)
      if (latest.current !== ticket) return
      setPage(data)
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

  /*
   * JL-101: swap authenticated image URLs for blob URLs after each render of
   * the body. Re-runs when the page changes; the blobs are revoked on the way
   * out so the bytes are not held for the life of the document.
   */
  useAuthedImages(bodyRef, [page?.id, page?.content])

  // JL-187: a table of contents is stored as a marker and built here, from
  // the headings as they are now, so it can never go stale.
  useEffect(() => {
    fillTablesOfContents(bodyRef.current?.querySelector('.wiki-viewer-content'))
  }, [page?.content])

  return (
    <div className="wiki-viewer">
      {loading && <LoadingState label="Loading page…" variant="skeleton" rows={6} />}
      {!loading && error && <ErrorState error={error} onRetry={load} />}

      {!loading && !error && page && (
        <article className="wiki-viewer-body" ref={bodyRef}>
          <header className="wiki-viewer-head">
            <h1>{page.title}</h1>
            <p className="wiki-viewer-meta">
              {/* JL-162: the Space name is the way back to the rest of the
                  Space. A page that names its Space but cannot reach it is
                  still a page floating on its own. `space_key` comes from the
                  same join JL-158 added. */}
              {page.space_key
                ? <Link className="wiki-viewer-space" to={`/spaces/${encodeURIComponent(page.space_key)}`}>{page.space_name}</Link>
                : 'No space'}
              {' · updated '}<RelativeTime value={page.updated_at} />
              {page.status === 'draft' && <span className="pill pill--lozenge pill-yellow">Draft</span>}
              {/* JL-187: editors see that a newer draft is waiting. */}
              {page.status !== 'draft' && page.draft_updated_at && canEdit && (
                <span className="pill pill--lozenge pill-gray">Unpublished changes</span>
              )}
            </p>
            {canEdit && (
              <div className="wiki-viewer-actions">
                <Button size="small" variant="outlined" onClick={() => navigate(`/wiki/pages/${page.id}/edit`)}>Edit</Button>
                <Button size="small" onClick={() => setShowHistory((v) => !v)}>
                  {showHistory ? 'Hide history' : 'History'}
                </Button>
                <IconButton
                  size="small"
                  aria-label="More actions"
                  aria-haspopup="menu"
                  onClick={(e) => setMoreAnchor(e.currentTarget)}
                >
                  <MoreHorizIcon fontSize="small" />
                </IconButton>
                <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
                  <MenuItem
                    onClick={() => { setMoreAnchor(null); trashPage(page) }}
                    sx={{ color: 'error.main' }}
                  >
                    <ListItemIcon sx={{ color: 'inherit' }}><DeleteOutlineIcon fontSize="small" /></ListItemIcon>
                    Move to trash
                  </MenuItem>
                </Menu>
              </div>
            )}
          </header>

          {trashDialog}
          {trashError && (
            <Alert severity="error" className="wiki-conflict" onClose={clearTrashError}>{trashError}</Alert>
          )}

          {/* JL-108/JL-109: history is read-only until a Restore, so it is
              available whether or not the reader can edit — the Restore
              control inside is what is gated. */}
          {showHistory && (
            <VersionHistoryPanel
              pageId={page.id}
              currentVersion={page.version}
              canEdit={canEdit}
              onClose={() => setShowHistory(false)}
              onRestored={load}
            />
          )}

          {body || <p className="wiki-viewer-empty">This page has no content yet.</p>}

          {/* JL-115: comments sit below the page, and only when reading it —
              a comment thread beside an open editor competes with the text
              the author is trying to write. */}
          {/* JL-120: attachments sit between the page and its comments —
              they belong to the page, and the discussion follows both. */}
          <PageAttachments pageId={page.id} />

          <PageComments pageId={page.id} />
        </article>
      )}
    </div>
  )
}

export default WikiPageViewer
