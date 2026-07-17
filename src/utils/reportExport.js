/**
 * reportExport.js — client-side report export helpers (no external deps).
 *
 * toCSV(rows, columns?) builds a CSV string from an array of objects.
 * downloadCSV(filename, rows, columns?) triggers a browser download via Blob + anchor.
 */

/** Escape a single CSV cell per RFC 4180 (quote if it contains comma/quote/newline). */
export function escapeCsvValue(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Convert an array of row objects into a CSV string.
 * @param {Array<Object>} rows
 * @param {Array<string|{key:string,label?:string}>} [columns] optional explicit column order/labels.
 *        When omitted, columns are inferred from the union of keys across rows.
 * @returns {string} CSV text with a header row (empty string when no rows/columns).
 */
export function toCSV(rows, columns) {
  const list = Array.isArray(rows) ? rows : []

  let cols = columns
  if (!cols || !cols.length) {
    const seen = []
    const seenSet = new Set()
    for (const row of list) {
      if (row && typeof row === 'object') {
        for (const key of Object.keys(row)) {
          if (!seenSet.has(key)) {
            seenSet.add(key)
            seen.push(key)
          }
        }
      }
    }
    cols = seen
  }

  const normalized = cols.map((c) =>
    typeof c === 'string' ? { key: c, label: c } : { key: c.key, label: c.label ?? c.key },
  )

  if (!normalized.length) return ''

  const header = normalized.map((c) => escapeCsvValue(c.label)).join(',')
  const body = list.map((row) =>
    normalized.map((c) => escapeCsvValue(row ? row[c.key] : '')).join(','),
  )

  return [header, ...body].join('\r\n')
}

/**
 * Build a CSV and trigger a browser download.
 * @param {string} filename
 * @param {Array<Object>} rows
 * @param {Array<string|{key:string,label?:string}>} [columns]
 */
export function downloadCSV(filename, rows, columns) {
  const csv = toCSV(rows, columns)
  // Prepend BOM so Excel detects UTF-8.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename && /\.csv$/i.test(filename) ? filename : `${filename || 'report'}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // Defer revoke so the download can start.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
