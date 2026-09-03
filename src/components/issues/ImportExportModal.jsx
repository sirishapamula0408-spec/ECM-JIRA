import { useState, useRef } from 'react'
import { downloadProjectExport, importIssues, readCsvFile, CsvReadError } from '../../api/importExportApi'
import './ImportExportModal.css'

export function ImportExportModal({ projectId, onClose, onImported, canImport = true, initialTab = 'export' }) {
  // JL-288: Viewers (canImport=false) may only export. Force the Export tab and
  // hide the Import tab/section entirely for them.
  const [tab, setTab] = useState(canImport ? initialTab : 'export')
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  // JL-450: the picked file, shown so the user can see WHICH file is loaded -
  // the textarea fills with its contents, and without the name it is not
  // obvious whether the text came from a file or was pasted.
  const [fileName, setFileName] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)
  // Nested elements fire dragenter/dragleave as the pointer crosses them, so a
  // naive boolean flickers. Counting depth is the same fix useAttachmentDropZone
  // uses for the issue-detail drop zone.
  const dragDepth = useRef(0)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function handleExport(format) {
    setError('')
    try {
      await downloadProjectExport(projectId, format)
    } catch (e) {
      setError(e?.message || 'Export failed')
    }
  }

  // JL-450 — the whole file path. Reads to text, then hands off to the exact
  // flow a paste already uses: fill the textarea, clear any stale preview. The
  // server never learns a file was involved.
  async function loadFile(file) {
    setError(''); setDone(''); setPreview(null)
    try {
      const text = await readCsvFile(file)
      setCsv(text)
      setFileName(file.name)
    } catch (e) {
      // CsvReadError messages are written for the user; anything else is not.
      setError(e instanceof CsvReadError ? e.message : 'Could not read that file.')
      setCsv('')
      setFileName('')
    }
  }

  function handleFilePicked(e) {
    const file = e.target.files?.[0]
    // Reset the input so re-picking the SAME file fires change again — without
    // this, fixing the file and re-choosing it appears to do nothing.
    e.target.value = ''
    if (file) loadFile(file)
  }

  const dropZoneProps = {
    onDragEnter: (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return
      e.preventDefault()
      dragDepth.current += 1
      setIsDragging(true)
    },
    onDragOver: (e) => {
      if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault()
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setIsDragging(false)
    },
    onDrop: (e) => {
      e.preventDefault()
      dragDepth.current = 0
      setIsDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) loadFile(file)
    },
  }

  async function handlePreview() {
    setError(''); setDone(''); setBusy(true)
    try {
      const result = await importIssues(projectId, { csv, dryRun: true })
      setPreview(result)
    } catch (e) {
      setError(e?.message || 'Preview failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleCommit() {
    setError(''); setBusy(true)
    try {
      const result = await importIssues(projectId, { csv, dryRun: false })
      setDone(`Imported ${result.created} issue(s).`)
      setPreview(null)
      setCsv('')
      setFileName('')
      onImported?.()
    } catch (e) {
      setError(e?.message || 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ie-overlay" onClick={onClose}>
      <div className="ie-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ie-header">
          <h3>{canImport ? 'Import / Export issues' : 'Export issues'}</h3>
          <button className="ie-close" type="button" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="ie-tabs">
          <button type="button" className={`ie-tab${tab === 'export' ? ' active' : ''}`} onClick={() => setTab('export')}>Export</button>
          {canImport && (
            <button type="button" className={`ie-tab${tab === 'import' ? ' active' : ''}`} onClick={() => setTab('import')}>Import</button>
          )}
        </div>

        {tab === 'export' && (
          <div className="ie-body">
            <p className="ie-hint">Download all issues in this project.</p>
            <div className="ie-actions">
              <button className="btn btn-primary" type="button" onClick={() => handleExport('csv')}>Export CSV</button>
              <button className="btn btn-ghost" type="button" onClick={() => handleExport('json')}>Export JSON</button>
            </div>
          </div>
        )}

        {canImport && tab === 'import' && (
          <div className="ie-body" {...dropZoneProps}>
            <p className="ie-hint">
              Upload a CSV, or paste one below. Needs a header row. Recognized columns: <code>title, description, priority, assignee, status, issue_type, sprint_id</code>. Only <code>title</code> is required.
            </p>

            {/* JL-450: the file route. Hidden input driven by a visible button,
                matching the attach control on the issue-detail page — a bare
                <input type="file"> cannot be styled consistently across
                browsers. The whole body is also a drop target. */}
            <div className={`ie-dropzone${isDragging ? ' ie-dropzone--active' : ''}`}>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                Choose CSV file
              </button>
              <span className="ie-dropzone-hint">
                {isDragging ? 'Drop to load' : fileName ? `Loaded: ${fileName}` : 'or drag one here'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={handleFilePicked}
              />
            </div>

            <textarea
              className="ie-textarea"
              rows={7}
              value={csv}
              onChange={(e) => { setCsv(e.target.value); setPreview(null); setFileName('') }}
              placeholder={'title,priority,status,assignee\nFix login bug,High,To Do,Sirisha'}
            />
            {preview && (
              <div className="ie-preview">
                <p>
                  <strong>{preview.valid}</strong> valid · <strong>{preview.invalid}</strong> invalid of {preview.totalRows} rows
                  {preview.warningCount > 0 && <> · <strong>{preview.warningCount}</strong> translated</>}
                </p>
                {/* JL-451: values that were MAPPED rather than rejected —
                    "In Prod" → "Done", "Highest" → "High". Shown before the
                    commit button so the translation is approved, not
                    discovered afterwards. A silent remap would be worse than
                    the rejection it replaces. */}
                {preview.warnings?.length > 0 && (
                  <ul className="ie-warnings">
                    {preview.warnings.map((w) => (
                      <li key={`${w.row}-${w.field}`}>
                        Row {w.row}: {w.field} <code>{w.from}</code> → <code>{w.to}</code>
                      </li>
                    ))}
                  </ul>
                )}
                {preview.errors?.length > 0 && (
                  <ul className="ie-errors">
                    {preview.errors.map((e) => (<li key={e.row}>Row {e.row}: {e.errors.join('; ')}</li>))}
                  </ul>
                )}
              </div>
            )}
            <div className="ie-actions">
              <button className="btn btn-ghost" type="button" onClick={handlePreview} disabled={busy || !csv.trim()}>Preview (dry run)</button>
              <button className="btn btn-primary" type="button" onClick={handleCommit} disabled={busy || !preview || preview.valid === 0}>
                Import{preview ? ` ${preview.valid}` : ''} issue(s)
              </button>
            </div>
          </div>
        )}

        {error && <p className="ie-error">{error}</p>}
        {done && <p className="ie-done">{done}</p>}
      </div>
    </div>
  )
}
