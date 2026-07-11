import { useState } from 'react'
import { downloadProjectExport, importIssues } from '../../api/importExportApi'
import './ImportExportModal.css'

export function ImportExportModal({ projectId, onClose, onImported }) {
  const [tab, setTab] = useState('export')
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
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
          <h3>Import / Export issues</h3>
          <button className="ie-close" type="button" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="ie-tabs">
          <button type="button" className={`ie-tab${tab === 'export' ? ' active' : ''}`} onClick={() => setTab('export')}>Export</button>
          <button type="button" className={`ie-tab${tab === 'import' ? ' active' : ''}`} onClick={() => setTab('import')}>Import</button>
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

        {tab === 'import' && (
          <div className="ie-body">
            <p className="ie-hint">
              Paste CSV with a header row. Recognized columns: <code>title, description, priority, assignee, status, issue_type, sprint_id</code>. Only <code>title</code> is required.
            </p>
            <textarea
              className="ie-textarea"
              rows={7}
              value={csv}
              onChange={(e) => { setCsv(e.target.value); setPreview(null) }}
              placeholder={'title,priority,status,assignee\nFix login bug,High,To Do,Sirisha'}
            />
            {preview && (
              <div className="ie-preview">
                <p><strong>{preview.valid}</strong> valid · <strong>{preview.invalid}</strong> invalid of {preview.totalRows} rows</p>
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
