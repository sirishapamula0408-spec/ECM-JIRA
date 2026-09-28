import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Button from '@mui/material/Button'
import { usePageTitle } from '../../hooks/usePageTitle'
import { EmptyState } from '../../components/common/EmptyState'
import { LoadingState, ErrorState } from '../../components/common/LoadingState'
import { RelativeTime } from '../../components/common/RelativeTime'
import { fetchWikiList } from '../../api/wikiHomeApi'
import { DocumentIcon, StarIcon, RecentIcon } from '../../components/wiki/WikiIcons'
import './WikiListPage.css'

/*
 * JL-152 — /wiki/recent and /wiki/starred.
 *
 * One component for both, because they differ only in which stamp they show
 * and which word they use. Two near-identical pages would have drifted the
 * first time one of them was touched.
 *
 * These exist because the sidebar offers "Show more". A nav affordance that
 * points at a route with nothing behind it is worse than not offering it.
 */
const KINDS = {
  recent: {
    kind: 'recent',
    title: 'Recently visited',
    stamp: (row) => row.viewed_at,
    verb: 'Visited',
    icon: <RecentIcon size={40} />,
    emptyTitle: 'Nothing visited yet',
    emptyBody: 'Pages you open will be listed here, most recent first.',
  },
  starred: {
    kind: 'starred',
    title: 'Starred pages',
    stamp: (row) => row.starred_at,
    verb: 'Starred',
    icon: <StarIcon size={40} />,
    emptyTitle: 'No starred pages',
    emptyBody: 'Star a page to keep it within reach from anywhere in Confluence Lite.',
  },
}

export function WikiListPage() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const config = pathname.endsWith('/starred') ? KINDS.starred : KINDS.recent

  usePageTitle(config.title)

  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchWikiList({ kind: config.kind })
      setItems(data.items ?? [])
      setCursor(data.nextCursor ?? null)
    } catch (err) {
      setError(err?.message || 'Could not load that list.')
    } finally {
      setLoading(false)
    }
  }, [config.kind])

  useEffect(() => { load() }, [load])

  async function loadMore() {
    if (cursor == null) return
    try {
      const data = await fetchWikiList({ kind: config.kind, cursor })
      setItems((current) => [...current, ...(data.items ?? [])])
      setCursor(data.nextCursor ?? null)
    } catch (err) {
      setError(err?.message || 'Could not load more.')
    }
  }

  return (
    <div className="wiki-list-page">
      <h1>{config.title}</h1>

      {loading && <LoadingState label="Loading…" variant="skeleton" rows={6} />}
      {!loading && error && <ErrorState error={error} onRetry={load} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          icon={config.icon}
          title={config.emptyTitle}
          description={config.emptyBody}
          action={<Button variant="contained" onClick={() => navigate('/wiki/home')}>Back to home</Button>}
        />
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <ul className="wiki-list">
            {items.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="wiki-list-row"
                  onClick={() => navigate(`/wiki/pages/${row.id}`)}
                >
                  <DocumentIcon size={16} />
                  <span className="wiki-list-title">{row.title}</span>
                  <span className="wiki-list-space">{row.space_name || 'No space'}</span>
                  <span className="wiki-list-time">
                    {config.verb} <RelativeTime value={config.stamp(row)} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {cursor != null && (
            <div className="wiki-list-more">
              <Button size="small" onClick={loadMore}>Show more</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default WikiListPage
