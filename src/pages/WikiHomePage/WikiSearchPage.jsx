import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import { usePageTitle } from '../../hooks/usePageTitle'
import { EmptyState } from '../../components/common/EmptyState'
import { LoadingState, ErrorState } from '../../components/common/LoadingState'
import { RelativeTime } from '../../components/common/RelativeTime'
import { SpaceAvatar } from '../../components/wiki/WikiSidebar'
import { DocumentIcon } from '../../components/wiki/WikiIcons'
import { searchWikiHomePages } from '../../api/wikiSearchApi'
import './WikiSearchPage.css'

/*
 * JL-110→114 — the search results page.
 *
 * The top bar shows the first few hits inline; this is where "all of them"
 * lives, with the Space filter and paging.
 *
 * ── Highlighting without markup ─────────────────────────────────────────────
 *
 * The server returns each excerpt as TEXT plus the offsets of the matches, and
 * this renders <mark> around those ranges itself. Nothing is parsed, nothing
 * reaches dangerouslySetInnerHTML, and no second markup-assembly path exists
 * beside sanitizeHtml (JL-359). Highlighting user content is the classic way
 * an XSS gets reintroduced; offsets make it impossible by construction.
 */

/** The URL is the state: a result list you cannot link to is half a feature. */
const PARAM_Q = 'q'
const PARAM_SPACE = 'spaceId'

/**
 * Render `text` with `ranges` wrapped in <mark>, as React elements.
 *
 * Offsets are clamped and checked for order rather than trusted: a malformed
 * range should degrade to plain text, never throw in the middle of a list.
 */
export function Highlighted({ text, ranges }) {
  const parts = useMemo(() => {
    const source = String(text ?? '')
    const list = Array.isArray(ranges) ? ranges : []
    const out = []
    let at = 0
    for (const range of list) {
      if (!Array.isArray(range) || range.length !== 2) continue
      const start = Math.max(0, Math.min(source.length, Number(range[0])))
      const end = Math.max(0, Math.min(source.length, Number(range[1])))
      if (!(end > start) || start < at) continue
      if (start > at) out.push({ mark: false, text: source.slice(at, start) })
      out.push({ mark: true, text: source.slice(start, end) })
      at = end
    }
    if (at < source.length) out.push({ mark: false, text: source.slice(at) })
    return out
  }, [text, ranges])

  return (
    <>
      {parts.map((part, i) => (
        part.mark
          ? <mark key={i} className="wiki-search-mark">{part.text}</mark>
          : <span key={i}>{part.text}</span>
      ))}
    </>
  )
}

export function WikiSearchPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  // The shell already loaded the Spaces this user can see — no second fetch
  // just to populate a filter.
  const { home } = useOutletContext() ?? {}
  const spaces = home?.spaces ?? []

  const term = params.get(PARAM_Q) || ''
  const spaceId = params.get(PARAM_SPACE) || ''

  usePageTitle(term ? `Search: ${term}` : 'Search')

  const [draft, setDraft] = useState(term)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)

  // Keep the box in step when the URL changes underneath it (back/forward).
  useEffect(() => { setDraft(term) }, [term])

  const run = useCallback(async () => {
    if (!term.trim()) {
      setResult(null)
      return
    }
    setLoading(true)
    setError('')
    try {
      setResult(await searchWikiHomePages(term, { spaceId: spaceId || undefined }))
    } catch (err) {
      // Say what failed. An empty list is the claim "nothing matched", which
      // is a different statement from "this did not run" (JL-248).
      setError(err?.message || 'Could not run that search.')
    } finally {
      setLoading(false)
    }
  }, [term, spaceId])

  useEffect(() => { run() }, [run])

  async function loadMore() {
    if (!result?.nextCursor) return
    setLoadingMore(true)
    try {
      const next = await searchWikiHomePages(term, {
        spaceId: spaceId || undefined,
        cursor: result.nextCursor,
      })
      setResult((current) => ({
        ...next,
        items: [...current.items, ...next.items],
      }))
    } catch (err) {
      setError(err?.message || 'Could not load more results.')
    } finally {
      setLoadingMore(false)
    }
  }

  function submit(event) {
    event.preventDefault()
    const next = new URLSearchParams(params)
    if (draft.trim()) next.set(PARAM_Q, draft.trim())
    else next.delete(PARAM_Q)
    setParams(next)
  }

  function changeSpace(value) {
    const next = new URLSearchParams(params)
    if (value) next.set(PARAM_SPACE, value)
    else next.delete(PARAM_SPACE)
    setParams(next)
  }

  const items = result?.items ?? []

  return (
    <div className="wiki-search-page">
      <h1>Search</h1>

      <form className="wiki-search-controls" onSubmit={submit} role="search">
        <TextField
          id="wiki-search-term"
          label="Search pages"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          size="small"
          fullWidth
        />
        <TextField
          id="wiki-search-space"
          select
          label="Space"
          value={spaceId}
          onChange={(e) => changeSpace(e.target.value)}
          size="small"
          className="wiki-search-space"
        >
          <MenuItem value="">All spaces</MenuItem>
          {spaces.map((s) => (
            <MenuItem key={s.id} value={String(s.id)}>{s.name}</MenuItem>
          ))}
        </TextField>
        <Button type="submit" variant="contained">Search</Button>
      </form>

      {!term.trim() && (
        <p className="wiki-search-hint">
          Search page titles, page content, and space names.
        </p>
      )}

      {loading && <LoadingState label="Searching…" variant="skeleton" rows={4} />}
      {!loading && error && <ErrorState error={error} onRetry={run} />}

      {!loading && !error && term.trim() && items.length === 0 && (
        <EmptyState
          icon={<DocumentIcon size={40} />}
          title={`No pages match “${term}”`}
          description={
            spaceId
              ? 'Nothing in this space matches. Try All spaces, or a different word.'
              : 'Try a different word, or check the page is in a space you can see.'
          }
        />
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <p className="wiki-search-count" role="status">
            {result.total} {result.total === 1 ? 'result' : 'results'}
            {spaceId && ' in this space'}
          </p>

          <ul className="wiki-search-results">
            {items.map((row) => (
              <li key={row.id} className="wiki-search-result">
                <button
                  type="button"
                  className="wiki-search-hit"
                  onClick={() => navigate(`/wiki/pages/${row.id}`)}
                >
                  <span className="wiki-search-title">
                    <DocumentIcon size={16} />
                    <Highlighted text={row.title} ranges={[]} />
                  </span>
                  <span className="wiki-search-excerpt">
                    {row.excerpt?.truncatedStart && '… '}
                    <Highlighted text={row.excerpt?.text} ranges={row.excerpt?.ranges} />
                    {row.excerpt?.truncatedEnd && ' …'}
                  </span>
                  <span className="wiki-search-meta">
                    {row.space_key && <SpaceAvatar space={{ key: row.space_key }} />}
                    {row.space_name || 'No space'} · updated <RelativeTime value={row.updated_at} />
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {result.hasMore && (
            <div className="wiki-search-more">
              <Button size="small" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Show more results'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default WikiSearchPage
