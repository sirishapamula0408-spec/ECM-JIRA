import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { LoadingState, ErrorState } from '../../components/common/LoadingState'
import { RelativeTime } from '../../components/common/RelativeTime'
import { fetchWikiPage } from '../../api/wikiApi'
import { recordPageView } from '../../api/wikiHomeApi'
import './WikiPageViewer.css'

/*
 * JL-152 — the page a home-page card opens.
 *
 * SCOPE NOTE. This is deliberately a reader, not the editor. A card that
 * navigates nowhere would have made "cards navigate to the correct page"
 * untestable and the whole section decorative, so the destination had to
 * exist; building the full Space-scoped page experience is JL-66's outstanding
 * UI work, not this ticket's. Editing still lives on the project wiki at
 * /projects/:id/wiki, which is untouched.
 *
 * Content is rendered inside <pre>, exactly as WikiPage does. That is not a
 * placeholder — wiki content is stored as plain markdown text and nothing here
 * puts it near dangerouslySetInnerHTML, so there is no second sanitiser to get
 * wrong (JL-359).
 */
export function WikiPageViewer() {
  const { pageId } = useParams()
  const [page, setPage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  usePageTitle(page?.title || 'Page')

  /*
   * The load lives in a useCallback rather than in the effect body:
   * `react-hooks/set-state-in-effect` is an error in this repo, and a
   * setLoading(true) sitting directly in an effect trips it. Same shape as
   * WikiShell and SpacesPage.
   *
   * `latest` is the in-flight token. Without it, navigating from one page to
   * the next while the first request is still open lets the slower response
   * land last and paint the page the user already left.
   */
  const latest = useRef(0)

  const load = useCallback(async () => {
    const ticket = latest.current + 1
    latest.current = ticket
    setLoading(true)
    setError('')
    try {
      const data = await fetchWikiPage(pageId)
      if (latest.current !== ticket) return
      setPage(data)
      /*
       * Record the read AFTER it succeeded, and never block on it: a failed
       * history write must not stop someone reading the page. The server
       * refuses views of pages the caller cannot see, so this cannot be used
       * to seed a history with pages they were never shown.
       */
      recordPageView(pageId).catch(() => {})
    } catch (err) {
      if (latest.current !== ticket) return
      setError(err?.message || 'Could not load that page.')
    } finally {
      if (latest.current === ticket) setLoading(false)
    }
  }, [pageId])

  useEffect(() => { load() }, [load])

  return (
    <div className="wiki-viewer">
      {loading && <LoadingState label="Loading page…" variant="skeleton" rows={6} />}
      {!loading && error && <ErrorState error={error} />}

      {!loading && !error && page && (
        <article className="wiki-viewer-body">
          <header className="wiki-viewer-head">
            <h1>{page.title}</h1>
            <p className="wiki-viewer-meta">
              {page.space_name || 'No space'} · updated <RelativeTime value={page.updated_at} />
              {page.status === 'draft' && <span className="pill pill--lozenge pill-yellow">Draft</span>}
            </p>
          </header>
          {page.content
            ? <pre className="wiki-content-pre">{page.content}</pre>
            : <p className="wiki-viewer-empty">This page has no content yet.</p>}
        </article>
      )}
    </div>
  )
}

export default WikiPageViewer
