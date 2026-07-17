import { Link } from 'react-router-dom'
import { tokenizeIssueKeys } from '../../utils/smartLinks'
import './SmartText.css'

/**
 * Render free text with JIRA-style issue keys (e.g. "JL-42") auto-linkified
 * to the issue-detail route (JL-138).
 *
 * The app routes issue detail at `/issues/:issueId` keyed by the numeric DB id,
 * while issue keys carry a per-project sequence number. To bridge the two, pass
 * the known `issues` list (`[{ id, key }]`); a key that resolves to a known
 * issue links to `/issues/<id>`, otherwise it falls back to `/issues/<KEY>`.
 *
 * Non-key text renders verbatim, unless a `renderText` render-prop is supplied
 * (used to compose with @mention rendering — see IssueDetailPage comments).
 *
 * @param {object}   props
 * @param {string}   props.text        Raw text to render.
 * @param {Array<{id:(number|string), key:string}>} [props.issues] Known issues for key→id resolution.
 * @param {(value:string, index:number)=>React.ReactNode} [props.renderText] Optional renderer for plain-text segments.
 */
export function SmartText({ text, issues, renderText }) {
  if (text == null || text === '') return null

  const byKey = new Map()
  if (Array.isArray(issues)) {
    for (const it of issues) {
      if (it && it.key != null) byKey.set(String(it.key), it)
    }
  }

  const segments = tokenizeIssueKeys(text)
  return (
    <span className="smart-text">
      {segments.map((seg, i) => {
        if (seg.type === 'issueKey') {
          const match = byKey.get(seg.key)
          const target = match ? match.id : seg.key
          return (
            <Link key={i} to={`/issues/${target}`} className="smart-issue-link" title={seg.key}>
              {seg.key}
            </Link>
          )
        }
        if (renderText) {
          return <span key={i}>{renderText(seg.value, i)}</span>
        }
        return <span key={i}>{seg.value}</span>
      })}
    </span>
  )
}

export default SmartText
