/* ================================================================
   JL-180: Shared CSV / NDJSON export utility.
   Dedupes the CSV/NDJSON serialization previously re-implemented in
   importExport.js (JL-40), auditLog.js (JL-132) and biExport.js (JL-156).
   Pure + deterministic. RFC-4180-style cell escaping.
   ================================================================ */

/**
 * Escape a single CSV cell (RFC 4180).
 * - null/undefined -> empty string
 * - wraps in double quotes when the cell contains a quote, comma, LF or CR
 * - doubles any internal double-quote
 * @param {*} value
 * @returns {string}
 */
export function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Normalize a columns spec into an array of { key, label }.
 * Accepts:
 *   - array of string keys (label === key)
 *   - array of { key, label } (label defaults to key)
 *   - falsy/empty -> keys inferred from the first row's own keys
 */
function normalizeColumns(columns, rows) {
  if (columns && columns.length) {
    return columns.map((c) =>
      typeof c === 'string'
        ? { key: c, label: c }
        : { key: c.key, label: c.label ?? c.key },
    )
  }
  const first = rows && rows[0]
  return first ? Object.keys(first).map((k) => ({ key: k, label: k })) : []
}

/**
 * Serialize rows to a CSV string with a header row.
 * Rows are joined with '\n' (no trailing newline), matching existing usage.
 * @param {object[]} rows
 * @param {(string|{key:string,label?:string})[]} [columns] column order / headers
 * @returns {string}
 */
export function toCsv(rows, columns) {
  const cols = normalizeColumns(columns, rows)
  const header = cols.map((c) => csvCell(c.label)).join(',')
  const body = (rows || []).map((row) => cols.map((c) => csvCell(row[c.key])).join(','))
  return [header, ...body].join('\n')
}

/**
 * Serialize rows to newline-delimited JSON (one JSON object per line).
 * Lines are joined with '\n' (no trailing newline), matching existing usage.
 * @param {object[]} rows
 * @returns {string}
 */
export function toNdjson(rows) {
  return (rows || []).map((r) => JSON.stringify(r)).join('\n')
}
