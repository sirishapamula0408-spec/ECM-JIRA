import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LoadingState } from '../common/LoadingState'
import { RelativeTime } from '../common/RelativeTime'
import { DocumentIcon } from './WikiIcons'
import { fetchPagesForIssue } from '../../api/wikiApi'
import './LinkedPages.css'

/*
 * JL-135 — documentation linked to an issue, shown on the issue.
 *
 * JL-136 made linking bidirectional in the DATA; this makes it bidirectional
 * in the product, which is the half a reader notices. Without it the link is
 * only discoverable from the page, so somebody working the issue never learns
 * the runbook exists.
 *
 * Renders NOTHING when there are no links or the fetch fails. This sits inside
 * an issue view that has its own concerns, and an empty "Linked pages (0)"
 * panel — or an error about a module the reader may not use — is noise on
 * somebody else's screen. The wiki is not the issue view's job to explain.
 */
export function LinkedPages({ issueId }) {
  const navigate = useNavigate()
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!issueId) return
    setLoading(true)
    try {
      const rows = await fetchPagesForIssue(issueId)
      setPages(Array.isArray(rows) ? rows : [])
    } catch {
      // Silent by design — see above.
      setPages([])
    } finally {
      setLoading(false)
    }
  }, [issueId])

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingState label="Loading linked pages…" variant="skeleton" rows={1} />
  if (pages.length === 0) return null

  return (
    <section className="linked-pages" aria-labelledby="linked-pages-heading">
      <h3 id="linked-pages-heading">
        Linked pages <span className="linked-pages-count">({pages.length})</span>
      </h3>
      <ul className="linked-pages-list">
        {pages.map((p) => (
          <li key={p.link_id ?? p.id}>
            <button type="button" className="linked-page" onClick={() => navigate(`/wiki/pages/${p.id}`)}>
              <DocumentIcon size={16} />
              <span className="linked-page-title">{p.title}</span>
              <span className="linked-page-meta">
                {p.space_name || 'No space'} · updated <RelativeTime value={p.updated_at} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default LinkedPages
