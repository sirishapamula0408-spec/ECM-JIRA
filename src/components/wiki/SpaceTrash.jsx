import { useCallback, useEffect, useState } from 'react'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import { EmptyState } from '../common/EmptyState'
import { LoadingState, ErrorState } from '../common/LoadingState'
import { RelativeTime } from '../common/RelativeTime'
import { DocumentIcon, TrashIcon } from './WikiIcons'
import { fetchWikiTrash, restoreWikiPage } from '../../api/wikiApi'

/*
 * JL-188 (fosasoft) — a Space's trash: the pages deleted from it, newest
 * first, each with Restore.
 *
 * The list comes from GET /api/wiki/trash, which applies the draft rule (an
 * author's deleted draft stays theirs alone). A restored page comes back at
 * the top level of the Space if its old parent is gone (JL-94).
 */
export function SpaceTrash({ spaceId, canRestore, onRestored }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchWikiTrash(spaceId)
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err?.message || 'Could not load the trash.')
    } finally {
      setLoading(false)
    }
  }, [spaceId])

  useEffect(() => { load() }, [load])

  async function restore(row) {
    setBusyId(row.id)
    setNotice('')
    try {
      await restoreWikiPage(row.id)
      setRows((current) => current.filter((r) => r.id !== row.id))
      setNotice(`“${row.title || 'Untitled'}” was restored.`)
      onRestored?.(row)
    } catch (err) {
      setError(err?.message || 'Could not restore that page.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <LoadingState label="Loading trash…" />
  if (error && rows.length === 0) return <ErrorState error={error} onRetry={load} />

  return (
    <div className="space-trash">
      {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {rows.length === 0 ? (
        <EmptyState
          icon={<TrashIcon size={40} />}
          title="The trash is empty"
          description="Pages deleted from this Space appear here, and can be restored."
        />
      ) : (
        <ul className="space-view-pages">
          {rows.map((row) => (
            <li key={row.id} className="space-trash-row">
              <span className="space-view-page space-trash-item">
                <DocumentIcon size={16} />
                <span className="space-view-page-title">{row.title || 'Untitled'}</span>
                <span className="space-view-page-meta">
                  deleted <RelativeTime value={row.deleted_at} />
                  {row.deleted_by ? ` by ${row.deleted_by}` : ''}
                </span>
              </span>
              {canRestore && (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busyId === row.id}
                  onClick={() => restore(row)}
                  aria-label={`Restore ${row.title || 'Untitled'}`}
                >
                  {busyId === row.id ? 'Restoring…' : 'Restore'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default SpaceTrash
