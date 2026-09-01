/**
 * Table — one table design for the whole app (JL-439).
 *
 * Native `<table>` rendering the shared `.table` classes from
 * styles/shared.css, for the same reason Input is native: seven pages already
 * hand-roll a table with those classes, and a MUI-based component here would
 * have produced two tables that look alike only by coincidence.
 *
 * `columns` is a list of `{ key, header, render?, width?, align? }`. `render`
 * receives `(row, index)` and defaults to `row[key]`. Supplying `children`
 * instead gives you the shell (bordered container, header treatment, hover) with
 * hand-written rows, which is what the more complex tables need.
 */
export function Table({
  columns = [],
  rows = [],
  getRowKey,
  empty = null,
  caption,
  className = '',
  children,
}) {
  const body = children ?? (
    rows.length === 0 && empty != null ? (
      <tr>
        <td colSpan={Math.max(columns.length, 1)} className="table-empty">
          {empty}
        </td>
      </tr>
    ) : (
      rows.map((row, i) => (
        <tr key={getRowKey ? getRowKey(row, i) : (row.id ?? i)}>
          {columns.map((col) => (
            <td key={col.key} style={col.align ? { textAlign: col.align } : undefined}>
              {col.render ? col.render(row, i) : row[col.key]}
            </td>
          ))}
        </tr>
      ))
    )
  )

  return (
    // Wide tables must scroll inside their own container rather than pushing
    // the page sideways.
    <div className={`table-shell ${className}`.trim()}>
      <table className="table">
        {caption != null && <caption className="table-caption">{caption}</caption>}
        {columns.length > 0 && (
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{
                    width: col.width,
                    textAlign: col.align || undefined,
                  }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>{body}</tbody>
      </table>
    </div>
  )
}
