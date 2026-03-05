import { useState, useMemo } from 'react'

export function FilterResultsGadget({ issues, config }) {
  const pageSize = config.pageSize || 10
  const [page, setPage] = useState(0)
  const [sortField, setSortField] = useState('key')
  const [sortDir, setSortDir] = useState('asc')

  const sorted = useMemo(() => {
    const list = [...issues]
    list.sort((a, b) => {
      const aVal = a[sortField] || ''
      const bVal = b[sortField] || ''
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

  const columns = [
    { key: 'key', label: 'Key' },
    { key: 'summary', label: 'Summary' },
    { key: 'assignee', label: 'Assignee' },
    { key: 'priority', label: 'Priority' },
    { key: 'status', label: 'Status' },
    { key: 'createdAt', label: 'Created' },
  ]

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
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} onClick={() => handleSort(col.key)} style={{ cursor: 'pointer' }}>
                  {col.label} <SortIcon field={col.key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageIssues.length === 0 && (
              <tr><td colSpan={columns.length} style={{ textAlign: 'center', color: '#6b778c' }}>No issues found</td></tr>
            )}
            {pageIssues.map((issue) => (
              <tr key={issue.id}>
                <td><span className="filter-results-key">{issue.key}</span></td>
                <td>{issue.summary}</td>
                <td>{issue.assignee || '—'}</td>
                <td><span className={`pill pill-priority pill-priority--${(issue.priority || '').toLowerCase()}`}>{issue.priority}</span></td>
                <td><span className="pill">{issue.status}</span></td>
                <td>{issue.createdAt || '—'}</td>
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
