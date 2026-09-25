import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { formatDateOnly } from '../../../utils/timeAgo'
import { StatusLozenge } from '../../common/StatusLozenge'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { issueHref } from '../../../utils/issueRef'

/*
 * JL-469 — the column list is the single declaration of a column.
 *
 * It used to be a bare {key,label} pair, and two separate defects grew out of
 * that:
 *
 *   • WIDTH. <th> and <td> each negotiated their own width from their own
 *     content, so the header row and the body rows disagreed about where a
 *     column starts. `width` here feeds a <colgroup>, and with
 *     `table-layout: fixed` (see DashboardPage.css) the browser resolves each
 *     column's width ONCE for the whole table — header and body are no longer
 *     sizing independently, so they cannot drift apart at all. Percentages, not
 *     px, so the grid still adapts to the gadget's width; the table carries a
 *     min-width and the wrapper scrolls rather than crushing the columns.
 *
 *   • VALUE. `summary` was read as `issue.summary`, but the API's issue shape
 *     (mapIssue in server/routes/issues.js) names that field `title`. Every
 *     SUMMARY cell was blank against real data — only the test fixtures, which
 *     happen to spell it `summary`, ever had a value, which is exactly why no
 *     test caught it. `get` reads both, so the gadget works against the API
 *     shape and the fixtures alike, and SORTING goes through the same accessor
 *     rather than re-reading the raw field and sorting a column of undefined.
 *
 * Alignment is deliberately NOT a per-column setting. Atlassian left-aligns
 * text, lozenge and date columns alike; the only column that would want
 * otherwise is a numeric one, and this grid has none. So it is declared once in
 * CSS against the table and applies to the header, the body and the empty-state
 * row together — three places that previously each made their own choice.
 *
 * JL-472 adds `narrowWidth`. Below 640px the two least load-bearing columns are
 * dropped (see OPTIONAL_COLUMN_KEYS) and the remaining four are re-proportioned
 * to fill the table, instead of side-scrolling the whole card on a phone.
 */
const COLUMNS = [
  { key: 'key', label: 'Key', width: '12%', narrowWidth: '18%', get: (i) => i.key || '' },
  // The API calls it `title`; the filter model and older fixtures call it
  // `summary`. Read both — see the note above.
  { key: 'summary', label: 'Summary', width: '34%', narrowWidth: '52%', get: (i) => i.summary ?? i.title ?? '' },
  { key: 'assignee', label: 'Assignee', width: '17%', get: (i) => i.assignee || '' },
  { key: 'priority', label: 'Priority', width: '12%', narrowWidth: '14%', get: (i) => i.priority || '' },
  { key: 'status', label: 'Status', width: '13%', narrowWidth: '16%', get: (i) => i.status || '' },
  { key: 'createdAt', label: 'Created', width: '12%', get: (i) => i.createdAt || '' },
]

const COLUMN_BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c]))
const summaryOf = COLUMN_BY_KEY.summary.get

/*
 * JL-472: dropped below 640px.
 *
 * Assignee and Created are the two columns a reader scanning a dashboard grid
 * on a phone is least likely to be there for — Key, Summary, Priority and
 * Status carry the row. They are dropped from the SOURCE LIST, not hidden with
 * `display: none`, because the <colgroup> and the cells are both derived from
 * that list: hide a <th>/<td> pair in CSS and the colgroup would still declare
 * six columns for a four-column row, which is precisely the header/body
 * disagreement JL-469 exists to prevent.
 */
const OPTIONAL_COLUMN_KEYS = new Set(['assignee', 'createdAt'])
const NARROW_QUERY = '(max-width: 640px)'

export function FilterResultsGadget({ issues, config }) {
  const pageSize = config.pageSize || 10
  const [page, setPage] = useState(0)
  const [sortField, setSortField] = useState('key')
  const [sortDir, setSortDir] = useState('asc')
  const isNarrow = useMediaQuery(NARROW_QUERY)

  const columns = useMemo(
    () => (isNarrow ? COLUMNS.filter((c) => !OPTIONAL_COLUMN_KEYS.has(c.key)) : COLUMNS),
    [isNarrow],
  )

  const sorted = useMemo(() => {
    // JL-469: sort through the column's accessor, not `a[sortField]`. Sorting
    // Summary by the raw field compared undefined with undefined on every row,
    // a no-op that just looked like "clicking Summary does nothing".
    //
    // Read from COLUMN_BY_KEY, not from the visible `columns`: a sort chosen on
    // a wide viewport must keep ordering the rows after the window narrows and
    // takes its column away, rather than silently reverting to unsorted.
    const read = COLUMN_BY_KEY[sortField]?.get || ((i) => i[sortField] || '')
    const list = [...issues]
    list.sort((a, b) => {
      const aVal = read(a)
      const bVal = read(b)
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return list
  }, [issues, sortField, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, totalPages - 1)
  const pageIssues = sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

  const handleSort = (field) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const SortIcon = ({ field }) => {
    if (field !== sortField) return <span className="sort-icon">⇅</span>
    return <span className="sort-icon">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="filter-results-gadget">
      <div className="filter-results-info">
        Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, sorted.length)} of {sorted.length} issues
      </div>
      <div className="filter-results-table-wrap">
        <table className="table filter-results-table">
          {/* JL-469: one width per column, declared against the column itself
              rather than against its <th>. This is what stops the header and
              the body from measuring themselves separately. */}
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={{ width: isNarrow ? col.narrowWidth : col.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  aria-sort={col.key === sortField ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {/* The label and its arrow are one inline-flex unit, so the
                      icon stays against the label instead of drifting to
                      wherever the cell's own alignment leaves it. */}
                  <span className="th-sort">
                    <span className="th-sort-label">{col.label}</span>
                    <SortIcon field={col.key} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageIssues.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="filter-results-empty">No issues found</td>
              </tr>
            )}
            {pageIssues.map((issue) => (
              <tr key={issue.id}>
                {columns.map((col) => (
                  <Cell key={col.key} column={col} issue={issue} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="filter-results-pagination">
          <button className="btn btn-ghost" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span>Page {currentPage + 1} of {totalPages}</span>
          <button className="btn btn-ghost" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}

/*
 * One cell renderer keyed off the column, so a column that is dropped on a
 * narrow viewport takes its cell with it automatically. The row used to be six
 * hand-written <td>s in a fixed order, which could not survive a variable
 * column list without going out of step with the <colgroup>.
 */
function Cell({ column, issue }) {
  switch (column.key) {
    case 'key':
      // JL-337: the key is styled like a link, so it must be one — a real
      // <Link> (not onClick+navigate) so middle-click / open-in-new-tab /
      // hover URL preview and keyboard Enter all work. The detail route is
      // keyed by numeric id (/issues/:issueId), not the display key.
      return <td><Link to={issueHref(issue)} className="filter-results-key">{issue.key}</Link></td>

    case 'summary': {
      // title attribute because the column is width-capped, so a long summary
      // ellipsizes instead of widening the column.
      const text = summaryOf(issue)
      return (
        <td className="filter-results-summary" title={text || undefined}>
          {text || '—'}
        </td>
      )
    }

    case 'assignee':
      return <td>{issue.assignee || '—'}</td>

    case 'priority':
      /*
       * JL-472: two fixes in one cell.
       *
       * An issue with no priority used to render `<span class="pill
       * pill-priority pill-priority--">{undefined}</span>` — an empty grey
       * capsule with nothing in it. It now takes the same em-dash fallback the
       * Assignee and Created cells already used.
       *
       * And the pill takes the `--lozenge` modifier, so Priority and the
       * StatusLozenge beside it are the same shape in two colours rather than
       * a round chip next to a square one. The modifier is opt-in precisely
       * because `.pill` also dresses label chips and count badges, which must
       * stay round and sentence-case (see shared.css).
       */
      return (
        <td>
          {issue.priority
            ? (
              <span className={`pill pill--lozenge pill-priority pill-priority--${issue.priority.toLowerCase()}`}>
                {issue.priority}
              </span>
            )
            : '—'}
        </td>
      )

    case 'status':
      /*
       * JL-472: a real <StatusLozenge>, not `<span class="pill">`.
       *
       * The plain pill painted every status the same flat grey, which said
       * nothing — and sat directly beneath a donut (JL-470) where each status
       * has its own colour, so the two halves of the same card disagreed about
       * whether status has a colour at all. The shared lozenge brings the
       * category colour, the colour-blind-safe glyph and the dark theme.
       *
       * readOnly: this is a dashboard readout, not an edit surface. The
       * read-only variant renders a plain <span> with no tab stop and no
       * transition menu, so the grid does not acquire 10 new focus targets.
       */
      return (
        <td>
          <StatusLozenge status={issue.status} readOnly context={issue.key} />
        </td>
      )

    case 'createdAt':
      // JL-338: display-only formatting — sorting still compares the raw
      // createdAt ISO string, which orders chronologically. formatDateOnly
      // shows the UTC calendar day (matching the stored timestamp) and returns
      // '' for missing/unparseable values, so the '—' fallback still applies.
      return <td>{formatDateOnly(issue.createdAt) || '—'}</td>

    default:
      return <td>{column.get(issue) || '—'}</td>
  }
}
