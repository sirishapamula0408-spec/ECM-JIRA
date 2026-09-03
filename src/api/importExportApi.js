import { api } from './client.js'

const TOKEN_KEY = 'jira_auth_token'
function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

// Export triggers a file download (CSV or JSON). Uses a raw fetch because the
// shared api() client always parses JSON, which would corrupt CSV payloads.
export async function downloadProjectExport(projectId, format = 'csv') {
  const res = await fetch(`/api/projects/${projectId}/export?format=${format}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `project-${projectId}-issues.${format}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// CSV import — dryRun returns a validation preview; dryRun:false commits.
export const importIssues = (projectId, { csv, mapping, dryRun }) =>
  api(`/api/projects/${projectId}/import`, {
    method: 'POST',
    body: JSON.stringify({ csv, mapping, dryRun }),
  })

/*
 * JL-450 — read a picked CSV file to text for the import flow.
 *
 * Deliberately readAsText, NOT the base64 route attachmentApi.js uses. That one
 * is base64 because an attachment is BINARY and has to round-trip byte-exact to
 * disk. A CSV is text, and the import endpoint already takes a plain string
 * (`{ csv }`), so reading to text is the same architectural choice — parse in
 * the browser, send JSON — with one fewer step. It also means the server needs
 * no change at all: it cannot tell a pasted string from a read one.
 *
 * multer was considered and rejected: a new dependency, a second body-parsing
 * path and a second auth surface, all to deliver a string the endpoint already
 * accepts.
 */

// Sized against the COMMIT loop, not the transport. server/routes/importExport
// inserts one row per await with no batching and — deliberately — no
// transaction, so a very large file is a long series of round-trips inside one
// request, and a failure part-way leaves earlier rows committed. ~2MB is on the
// order of 10-20k rows, which is already generous. express.json allows 25mb;
// that is not the binding constraint.
export const MAX_CSV_BYTES = 2 * 1024 * 1024

export class CsvReadError extends Error {}

/**
 * Read a File to a CSV string, or throw CsvReadError with a message meant for
 * the user rather than the console.
 */
export function readCsvFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new CsvReadError('No file selected.'))
    if (file.size > MAX_CSV_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1)
      return reject(new CsvReadError(
        `That file is ${mb}MB. The limit is ${MAX_CSV_BYTES / 1024 / 1024}MB — split it and import in parts.`,
      ))
    }

    // Detect UTF-16 before reading as text. Excel's "Unicode Text (*.txt)" and
    // some regional CSV saves are UTF-16LE; readAsText assumes UTF-8 and would
    // hand back NUL-interleaved garbage, failing every row with a message that
    // explains nothing. A BOM is NOT a problem by contrast — U+FEFF is
    // whitespace to String.prototype.trim, and the server trims its headers.
    const head = new FileReader()
    head.onerror = () => reject(new CsvReadError('Could not read that file.'))
    head.onload = () => {
      const b = new Uint8Array(head.result)
      const utf16 = b.length >= 2
        && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))
      if (utf16) {
        return reject(new CsvReadError(
          'That file is UTF-16. Re-save it from Excel as "CSV UTF-8 (Comma delimited)".',
        ))
      }
      const reader = new FileReader()
      reader.onerror = () => reject(new CsvReadError('Could not read that file.'))
      reader.onload = () => {
        const text = String(reader.result ?? '')
        if (!text.trim()) return reject(new CsvReadError('That file is empty.'))
        // The server's parser splits on "," only. A semicolon export (common in
        // European Excel locales) parses as ONE column, so every row fails with
        // "title is required" and no clue why. Catch it here where we can say so.
        const firstLine = text.split(/\r?\n/, 1)[0] || ''
        if (!firstLine.includes(',') && firstLine.includes(';')) {
          return reject(new CsvReadError(
            'That file looks semicolon-separated. Re-save it comma-delimited, or paste it and fix the separators.',
          ))
        }
        resolve(text)
      }
      reader.readAsText(file)
    }
    head.readAsArrayBuffer(file.slice(0, 2))
  })
}
