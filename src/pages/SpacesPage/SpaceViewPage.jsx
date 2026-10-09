import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import { usePageTitle } from '../../hooks/usePageTitle'
import { EmptyState } from '../../components/common/EmptyState'
import { LoadingState, ErrorState } from '../../components/common/LoadingState'
import { RelativeTime } from '../../components/common/RelativeTime'
import { DocumentIcon, SpacesIcon } from '../../components/wiki/WikiIcons'
import { SpaceAvatar } from '../../components/wiki/WikiSidebar'
import { SpaceDocuments } from '../../components/documents/SpaceDocuments'
import { SpaceTrash } from '../../components/wiki/SpaceTrash'
import { fetchSpace } from '../../api/spaceApi'
import { fetchWikiList } from '../../api/wikiHomeApi'
import { restoreWikiPage } from '../../api/wikiApi'
import './SpaceViewPage.css'

/*
 * JL-162 — one Space, and the pages that live in it.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * Pages were only ever listed in reader-centric piles: Recent (what I looked
 * at), Starred (what I kept), the feed (what changed anywhere). Nothing in the
 * product answered "what is IN this Space" — which is the question a Space
 * exists to answer, and the reason to put a page in one. Clicking a Space in
 * the sidebar navigated to /spaces?key=ENG, and the directory page ignored the
 * parameter outright, so it silently dropped you on the list of all Spaces.
 *
 * ── Two requests, and why not one ───────────────────────────────────────────
 *
 * The Space is addressed by KEY in the URL (/spaces/ENG, readable and typeable
 * — the same reasoning as JL-148 for issues), but the list endpoint narrows by
 * space_id. So this resolves the Space first and then asks for its pages.
 *
 * A single /api/spaces/:key/pages would save a round trip, and was not added:
 * the page list already exists, already carries the visibility filter, and
 * already paginates. A second endpoint would be a second place for that filter
 * to be stated — which is the mistake JL-139 was, when the version endpoints
 * had no visibility check because they were written separately.
 *
 * `kind=modified` is the right pile here for the same reason the endpoint
 * takes a spaceId only for that kind: it is a property of the Space rather
 * than of the reader.
 */

const PAGE_SIZE = 50

export function SpaceViewPage() {
  const { spaceKey } = useParams()
  const navigate = useNavigate()
  /*
   * JL-188: deleting a page lands here, carrying what was deleted so the
   * Space can say so and offer Undo. Read once, then cleared from history:
   * browser history keeps state across a reload, and a refresh of this URL
   * is not another deletion.
   */
  const location = useLocation()
  const [trashed, setTrashed] = useState(location.state?.trashed ?? null)
  const arrivedFromDelete = Boolean(location.state?.trashed)
  useEffect(() => {
    if (arrivedFromDelete) navigate('.', { replace: true, state: null })
  }, [arrivedFromDelete, navigate])

  const [space, setSpace] = useState(null)
  const [pages, setPages] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /*
   * JL-164: the Documents tab (spec section 1). Kept in component state
   * rather than the URL for now — the Space itself is the addressable thing,
   * and a tab is a view of it. Promote it to a route segment if deep-linking
   * to Documents is ever asked for.
   */
  const [tab, setTab] = useState('pages')

  usePageTitle(space?.name || 'Space')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const found = await fetchSpace(spaceKey)
      setSpace(found)
      const list = await fetchWikiList({ kind: 'modified', spaceId: found.id, limit: PAGE_SIZE })
      setPages(list?.items ?? [])
      setHasMore(Boolean(list?.hasMore))
    } catch (err) {
      /*
       * A Space the caller cannot see is a 404 from the server, deliberately
       * (saying it exists but is closed to you is itself a disclosure). So the
       * message is the server's, not a guess at which of the two happened.
       */
      setError(err?.message || 'Could not load this Space.')
    } finally {
      setLoading(false)
    }
  }, [spaceKey])

  useEffect(() => { load() }, [load])

  /*
   * JL-188: after a restore, refresh only the page list. load() swaps the
   * whole Space for a spinner, which unmounted the Trash tab and lost its
   * "restored" confirmation the moment it appeared.
   */
  const refreshPages = useCallback(async () => {
    if (!space) return
    try {
      const list = await fetchWikiList({ kind: 'modified', spaceId: space.id, limit: PAGE_SIZE })
      setPages(list?.items ?? [])
      setHasMore(Boolean(list?.hasMore))
    } catch {
      /* the list is refreshed again the next time the Space is opened */
    }
  }, [space])

  async function undoTrash() {
    if (!trashed) return
    try {
      await restoreWikiPage(trashed.id)
      setTrashed(null)
      navigate(`/wiki/pages/${trashed.id}`)
    } catch (err) {
      setTrashed({ ...trashed, error: err?.message || 'Could not restore the page.' })
    }
  }

  if (loading) return <section className="page space-view"><LoadingState label="Loading Space…" /></section>
  if (error) {
    return (
      <section className="page space-view">
        <ErrorState error={error} onRetry={load} />
      </section>
    )
  }

  return (
    <section className="page space-view">
      <header className="space-view-head">
        <SpaceAvatar space={space} />
        <div className="space-view-heading">
          <h1>{space.name}</h1>
          <p className="space-view-meta">
            <span className="space-view-key">{space.key}</span>
            {space.archived && <span className="pill pill--lozenge pill-yellow">Archived</span>}
            <span>
              {pages.length}{hasMore ? '+' : ''} {pages.length === 1 ? 'page' : 'pages'}
            </span>
          </p>
        </div>
        {/* Archived Spaces stop accepting new pages (JL-84), so the action
            that would fail is not offered. */}
        {!space.archived && (
          <Button variant="contained" onClick={() => navigate(`/wiki/new?spaceId=${space.id}`)}>
            Create page
          </Button>
        )}
      </header>

      {space.description && <p className="space-view-desc">{space.description}</p>}

      {trashed && (
        <Alert
          severity={trashed.error ? 'error' : 'success'}
          className="space-view-notice"
          onClose={() => setTrashed(null)}
          action={!trashed.error && <Button size="small" color="inherit" onClick={undoTrash}>Undo</Button>}
        >
          {trashed.error || `“${trashed.title || 'Untitled'}” was moved to the trash.`}
        </Alert>
      )}

      {/* Section 1: every Space has a Documents section beside its Pages. */}
      <div className="space-view-tabs" role="tablist" aria-label="Space sections">
        {[['pages', 'Pages'], ['documents', 'Documents'], ['trash', 'Trash']].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`space-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`space-panel-${id}`}
            className={`space-view-tab${tab === id ? ' space-view-tab--active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'documents' && (
        <div role="tabpanel" id="space-panel-documents" aria-labelledby="space-tab-documents">
          <SpaceDocuments
            spaceKey={space.key}
            /* The server decides both of these again on every request; these
               only govern whether a control that would 403 is offered. */
            canUpload={!space.archived && ['Admin', 'Member'].includes(space.myRole)}
            canManage={space.myRole === 'Admin'}
          />
        </div>
      )}

      {tab === 'trash' && (
        <div role="tabpanel" id="space-panel-trash" aria-labelledby="space-tab-trash">
          <SpaceTrash
            spaceId={space.id}
            /* The server checks this again; it only decides whether Restore is offered. */
            canRestore={['Admin', 'Member'].includes(space.myRole)}
            onRestored={refreshPages}
          />
        </div>
      )}

      {tab === 'pages' && (
      <div role="tabpanel" id="space-panel-pages" aria-labelledby="space-tab-pages">
      {pages.length === 0 ? (
        <EmptyState
          icon={<SpacesIcon size={40} />}
          title="No pages in this Space yet"
          description={`Pages created in ${space.name} appear here, newest change first.`}
          action={space.archived ? null : (
            <Button variant="contained" onClick={() => navigate(`/wiki/new?spaceId=${space.id}`)}>
              Create the first page
            </Button>
          )}
        />
      ) : (
        <ul className="space-view-pages">
          {pages.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                className="space-view-page"
                onClick={() => navigate(`/wiki/pages/${page.id}`)}
              >
                <DocumentIcon size={16} />
                <span className="space-view-page-title">{page.title}</span>
                <span className="space-view-page-meta">
                  updated <RelativeTime value={page.modified_at || page.updated_at} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <p className="space-view-more">
          Showing the {PAGE_SIZE} most recently changed pages in this Space.
        </p>
      )}
      </div>
      )}
    </section>
  )
}

export default SpaceViewPage
