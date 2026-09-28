import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import Button from '@mui/material/Button'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Skeleton from '@mui/material/Skeleton'
import { usePageTitle } from '../../hooks/usePageTitle'
import { EmptyState } from '../../components/common/EmptyState'
import { ErrorState } from '../../components/common/LoadingState'
import { RelativeTime } from '../../components/common/RelativeTime'
import { avatarStyle } from '../../utils/avatarColour'
import { displayNameFromEmail } from '../../utils/helpers'
import { fetchWikiFeed } from '../../api/wikiHomeApi'
import { DocumentIcon, CaretDownIcon, TeammatesIcon, SpacesIcon } from '../../components/wiki/WikiIcons'
import './WikiHomePage.css'

/*
 * JL-152 / JL-153 / JL-154 — the Confluence Lite home page.
 *
 * ── What this page is now ───────────────────────────────────────────────────
 *
 * One section: the activity feed. The "Pick up where you left off" card grid
 * was REMOVED at the user's request (JL-154). Recently-viewed pages are still
 * one click away in the sidebar's Recent section, which is where that same
 * information lives without a mostly-empty grid holding the top of the page.
 *
 * ── Fetching ────────────────────────────────────────────────────────────────
 *
 * The sidebar's payload (GET /api/wiki-home) belongs to <ConfluenceLayout> and
 * reaches this page through the outlet context — it is not fetched twice. The
 * feed is fetched here, separately and paginated, so a slow feed cannot hold
 * up the shell.
 *
 * ── Reuse ───────────────────────────────────────────────────────────────────
 *
 *   EmptyState      components/common/EmptyState.jsx (JL-244)
 *   ErrorState      components/common/LoadingState.jsx
 *   RelativeTime    components/common/RelativeTime.jsx
 *   avatarStyle     utils/avatarColour.js
 *   MUI <Menu>      the same dropdown StatusLozenge (JL-384) and the JL-151
 *                   app switcher use; no second popover was written
 */

const SORTS = [
  { id: 'relevant', label: 'Most relevant' },
  { id: 'recent', label: 'Most recent' },
]

const TABS = [
  { id: 'following', label: 'Following' },
  { id: 'popular', label: 'Popular' },
]

function FeedRow({ item, onOpen }) {
  const actor = displayNameFromEmail(item.actor)
  const verb = item.kind === 'page_created' ? 'created' : 'updated'
  return (
    <li className="wiki-feed-row">
      <span className="wiki-feed-avatar" style={avatarStyle(item.actor)} aria-hidden="true">
        {actor.charAt(0).toUpperCase()}
      </span>
      <span className="wiki-feed-text">
        <span className="wiki-feed-line">
          <strong>{actor}</strong> {verb}{' '}
          <button type="button" className="wiki-feed-link" onClick={() => onOpen(item)}>
            {item.title}
          </button>
        </span>
        <span className="wiki-feed-meta">
          {item.space_name || 'No space'} · <RelativeTime value={item.at} />
        </span>
      </span>
    </li>
  )
}

/*
 * JL-154: a COMPACT empty state, not the full-height <EmptyState> block. A
 * section with nothing in it should occupy a line or two, not reserve a screen
 * of blank space — which is what made the page read as broken rather than new.
 * It matches the sidebar's "Nothing viewed yet" treatment.
 */
function CompactEmpty({ icon, children, action }) {
  return (
    <div className="wiki-compact-empty" role="status">
      {icon && <span className="wiki-compact-empty-icon" aria-hidden="true">{icon}</span>}
      <span className="wiki-compact-empty-text">{children}</span>
      {action}
    </div>
  )
}

export function WikiHomePage() {
  usePageTitle('Confluence Lite')
  const navigate = useNavigate()

  // Supplied by <ConfluenceLayout>. `?? {}` keeps the page renderable when it
  // is mounted outside the shell, which is what the component tests do.
  const { home, homeLoading = false } = useOutletContext() ?? {}

  const [feed, setFeed] = useState({ items: [], hasMore: false, nextCursor: null })
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState('')
  const [tab, setTab] = useState('following')
  const [sort, setSort] = useState('relevant')
  const [sortAnchor, setSortAnchor] = useState(null)
  const sortRef = useRef(null)

  const loadFeed = useCallback(async (nextTab, nextSort) => {
    setFeedLoading(true)
    setFeedError('')
    try {
      setFeed(await fetchWikiFeed({ tab: nextTab, sort: nextSort, cursor: 0 }))
    } catch (err) {
      setFeedError(err?.message || 'Could not load the activity feed.')
    } finally {
      setFeedLoading(false)
    }
  }, [])

  useEffect(() => { loadFeed(tab, sort) }, [loadFeed, tab, sort])

  async function loadMore() {
    if (feed.nextCursor == null) return
    try {
      const next = await fetchWikiFeed({ tab, sort, cursor: feed.nextCursor })
      setFeed((current) => ({
        items: [...current.items, ...next.items],
        hasMore: next.hasMore,
        nextCursor: next.nextCursor,
      }))
    } catch (err) {
      setFeedError(err?.message || 'Could not load more activity.')
    }
  }

  const openPage = useCallback((item) => {
    navigate(`/wiki/pages/${item.page_id ?? item.id}`)
  }, [navigate])

  /*
   * First run — no spaces at all. This is the one case that earns a full
   * EmptyState, because there is genuinely nothing to do on the page yet and
   * the user needs somewhere to go.
   */
  const firstRun = !homeLoading && (home?.spaces?.length ?? 0) === 0

  return (
    <div className="wiki-home">
      {firstRun && (
        <EmptyState
          icon={<SpacesIcon size={40} />}
          title="Welcome to Confluence Lite"
          description="Spaces hold documentation that outlives any one project — runbooks, onboarding guides, decision logs. Create one to get started."
          action={<Button variant="contained" onClick={() => navigate('/spaces')}>Create a space</Button>}
        />
      )}

      {!firstRun && (
        <section className="wiki-home-section" aria-labelledby="wiki-feed-heading">
          <div className="wiki-feed-head">
            {/* The page's leading heading, so it is the <h1> — a page with no
                level-1 heading is the JL-409 problem. */}
            <h1 id="wiki-feed-heading" className="wiki-home-heading">
              Discover what&apos;s happening
            </h1>
            <div className="wiki-feed-controls">
              <button
                ref={sortRef}
                type="button"
                className="wiki-sort-trigger"
                aria-haspopup="menu"
                aria-expanded={Boolean(sortAnchor)}
                onClick={() => setSortAnchor((a) => (a ? null : sortRef.current))}
              >
                Sort by: {SORTS.find((s) => s.id === sort)?.label}
                <CaretDownIcon size={16} />
              </button>
              <Menu
                anchorEl={sortAnchor}
                open={Boolean(sortAnchor)}
                onClose={() => setSortAnchor(null)}
                transitionDuration={0}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                MenuListProps={{ 'aria-label': 'Sort the feed' }}
              >
                {SORTS.map((option) => (
                  <MenuItem
                    key={option.id}
                    selected={option.id === sort}
                    onClick={() => { setSort(option.id); setSortAnchor(null) }}
                  >
                    {option.label}
                  </MenuItem>
                ))}
              </Menu>
              <Button size="small" variant="outlined" onClick={() => navigate('/spaces')}>
                Edit feed
              </Button>
            </div>
          </div>

          <div className="wiki-tabs" role="tablist" aria-label="Feed">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`wiki-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="wiki-feed-panel"
                className={`wiki-tab${tab === t.id ? ' wiki-tab--selected' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div
            className="wiki-feed"
            id="wiki-feed-panel"
            role="tabpanel"
            aria-labelledby={`wiki-tab-${tab}`}
          >
            {feedLoading && (
              <ul className="wiki-feed-list" aria-busy="true">
                {Array.from({ length: 3 }, (_, i) => (
                  <li className="wiki-feed-row" key={i}>
                    <Skeleton variant="circular" width={32} height={32} />
                    <div className="wiki-feed-text">
                      <Skeleton variant="text" width="65%" height={20} />
                      <Skeleton variant="text" width="35%" height={16} />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {!feedLoading && feedError && (
              <ErrorState error={feedError} onRetry={() => loadFeed(tab, sort)} />
            )}

            {!feedLoading && !feedError && feed.items.length === 0 && tab === 'following' && (
              <CompactEmpty
                icon={<TeammatesIcon size={20} />}
                action={(
                  <Button size="small" variant="text" onClick={() => navigate('/users')}>
                    Invite teammates
                  </Button>
                )}
              >
                No activity from your team yet.
              </CompactEmpty>
            )}

            {!feedLoading && !feedError && feed.items.length === 0 && tab === 'popular' && (
              <CompactEmpty icon={<DocumentIcon size={20} />}>
                Nothing popular yet — pages show up here once they are read.
              </CompactEmpty>
            )}

            {!feedLoading && !feedError && feed.items.length > 0 && (
              <>
                <ul className="wiki-feed-list">
                  {feed.items.map((item) => (
                    <FeedRow key={`${item.kind}-${item.page_id}-${item.at}`} item={item} onOpen={openPage} />
                  ))}
                </ul>
                {/* Lazy, not "load everything": the next page is fetched only
                    when asked for. */}
                {feed.hasMore && (
                  <div className="wiki-feed-more">
                    <Button size="small" onClick={loadMore}>Show more activity</Button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

export default WikiHomePage
