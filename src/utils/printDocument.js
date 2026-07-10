/**
 * printDocument.js — dependency-free "Export to PDF" via the browser's print dialog.
 *
 * Strategy: build a clean, self-contained, print-optimized HTML document from an
 * issue (or report), open it in a new window, and invoke the browser's native
 * print dialog (Save as PDF). No server-side PDF libraries.
 *
 * Both functions are pure/injectable so they can be unit-tested without a real browser.
 */

/**
 * Escape a string for safe interpolation into HTML text/attributes.
 * Prevents XSS in the generated document from user-controlled fields.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Render a label/value definition row, skipping empty values unless forced. */
function fieldRow(label, value, { force = false } = {}) {
  const str = value === null || value === undefined ? '' : String(value)
  if (!str.trim() && !force) return ''
  return `<div class="pd-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(str) || '&mdash;'}</dd></div>`
}

/** Render assigned labels as colored chips (name + optional color). */
function renderLabels(labels) {
  if (!Array.isArray(labels) || labels.length === 0) return ''
  const chips = labels
    .map((l) => {
      const name = escapeHtml(l && l.name != null ? l.name : l)
      const color = l && typeof l.color === 'string' ? l.color : ''
      const style = /^#[0-9a-fA-F]{3,8}$/.test(color) ? ` style="border-color:${color};color:${color}"` : ''
      return `<span class="pd-chip"${style}>${name}</span>`
    })
    .join(' ')
  return `<div class="pd-row"><dt>Labels</dt><dd class="pd-chips">${chips}</dd></div>`
}

/**
 * Build a self-contained, print-optimized HTML document for a single issue.
 * All user text is HTML-escaped to avoid injection into the generated document.
 *
 * @param {Object} issue        the issue record (key/title/status/assignee/priority/description/...)
 * @param {Object} [opts]
 * @param {string} [opts.projectName] project display name for the header
 * @param {Array}  [opts.labels]      assigned labels ([{name,color}] or strings)
 * @param {string} [opts.generatedAt] ISO/text timestamp shown in the footer
 * @returns {string} a complete HTML document string (starts with <!doctype html>)
 */
export function buildIssuePrintHtml(issue, opts = {}) {
  const safeIssue = issue && typeof issue === 'object' ? issue : {}
  const { projectName = '', labels = [], generatedAt } = opts

  const key = safeIssue.key || (safeIssue.id != null ? `IT-${safeIssue.id}` : '')
  const title = safeIssue.title || '(untitled)'
  const description = safeIssue.description || ''
  const stamp = generatedAt || new Date().toLocaleString()

  const detailRows = [
    fieldRow('Status', safeIssue.status, { force: true }),
    fieldRow('Type', safeIssue.issueType),
    fieldRow('Priority', safeIssue.priority),
    fieldRow('Assignee', safeIssue.assignee || 'Unassigned', { force: true }),
    fieldRow('Reporter', safeIssue.reporter),
    fieldRow('Sprint', safeIssue.sprintName),
    fieldRow('Story points', safeIssue.storyPoints),
    fieldRow('Start date', safeIssue.startDate ? String(safeIssue.startDate).slice(0, 10) : ''),
    fieldRow('Due date', safeIssue.dueDate ? String(safeIssue.dueDate).slice(0, 10) : ''),
    fieldRow('Components', safeIssue.components),
    fieldRow('Environment', safeIssue.environment),
    fieldRow('Resolution', safeIssue.resolution),
    renderLabels(labels),
  ]
    .filter(Boolean)
    .join('\n')

  const descBlock = description.trim()
    ? `<p class="pd-desc">${escapeHtml(description).replace(/\n/g, '<br/>')}</p>`
    : `<p class="pd-desc pd-muted">No description provided.</p>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(key)} ${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 40px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #172b4d;
    background: #fff;
    line-height: 1.5;
  }
  .pd-crumb { font-size: 12px; color: #6b778c; margin-bottom: 4px; }
  .pd-key { font-size: 13px; font-weight: 600; color: #0052cc; letter-spacing: .02em; }
  h1.pd-title { font-size: 24px; margin: 4px 0 20px; font-weight: 600; }
  h2.pd-h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: #6b778c; margin: 24px 0 8px; }
  dl.pd-details { margin: 0; display: grid; grid-template-columns: 160px 1fr; gap: 6px 16px; }
  .pd-row { display: contents; }
  .pd-row dt { color: #6b778c; font-size: 13px; }
  .pd-row dd { margin: 0; font-size: 13px; color: #172b4d; }
  .pd-desc { font-size: 14px; white-space: normal; }
  .pd-muted { color: #97a0af; }
  .pd-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .pd-chip {
    display: inline-block; padding: 1px 8px; border: 1px solid #c1c7d0; border-radius: 3px;
    font-size: 12px; color: #42526e; background: #fff;
  }
  .pd-divider { border: none; border-top: 1px solid #dfe1e6; margin: 24px 0; }
  .pd-footer { margin-top: 32px; font-size: 11px; color: #97a0af; }
  @media print {
    body { padding: 0; }
    .pd-footer { position: fixed; bottom: 0; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>
  <div class="pd-crumb">${escapeHtml(projectName || 'Project')}</div>
  <div class="pd-key">${escapeHtml(key)}</div>
  <h1 class="pd-title">${escapeHtml(title)}</h1>

  <h2 class="pd-h2">Details</h2>
  <dl class="pd-details">
    ${detailRows}
  </dl>

  <hr class="pd-divider"/>

  <h2 class="pd-h2">Description</h2>
  ${descBlock}

  <div class="pd-footer">Generated ${escapeHtml(stamp)}</div>
</body>
</html>`
}

/**
 * Open the HTML in a new window and trigger the print dialog.
 * Injectable for testing — pass `windowFactory` and/or `print` to avoid touching
 * the real `window.open`.
 *
 * @param {string} html
 * @param {Object} [opts]
 * @param {() => (Window|null)} [opts.windowFactory] returns the target window (default: window.open)
 * @param {(win: Window) => void} [opts.print] invoked with the opened window (default: win.print())
 * @returns {Window|null} the opened window, or null if it was blocked (popup blocker)
 */
export function openPrintWindow(html, opts = {}) {
  const {
    windowFactory = () => (typeof window !== 'undefined' ? window.open('', '_blank') : null),
    print = (win) => {
      try { win.focus() } catch { /* ignore */ }
      win.print()
    },
  } = opts

  const win = windowFactory()
  if (!win) return null

  try {
    win.document.open()
    win.document.write(html)
    win.document.close()
  } catch {
    // Some environments restrict document access; still attempt to print.
  }

  try {
    print(win)
  } catch {
    // Printing may be unavailable (e.g. sandbox); return the window regardless.
  }

  return win
}
