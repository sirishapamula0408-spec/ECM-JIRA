import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import LinearProgress from '@mui/material/LinearProgress'
import Menu from '@mui/material/Menu'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import { EmptyState } from '../common/EmptyState'
import { LoadingState, ErrorState } from '../common/LoadingState'
import { RelativeTime } from '../common/RelativeTime'
import { DocumentIcon, FolderIcon } from '../wiki/WikiIcons'
import { DocumentUploadDialog } from './DocumentUploadDialog'
import { DocumentVersionsDialog } from './DocumentVersionsDialog'
import {
  FolderFormDialog, DeleteFolderDialog, MoveDocumentDialog,
} from './DocumentFolderDialogs'
import {
  fetchDocuments, fetchFolders, deleteDocument, updateDocument,
  documentDownloadUrl, documentPreviewUrl, formatBytes,
} from '../../api/documentApi'
import './SpaceDocuments.css'

/*
 * JL-164 — the Documents tab for a Space (spec sections 6, 8, 16).
 *
 * Listing, search, filters, folder navigation, storage usage and the per-row
 * actions. Search and every filter are sent to the SERVER rather than applied
 * to a fetched list: filtering in the browser would mean documents from
 * folders and Spaces the caller cannot see travelling to them first, and it
 * would break pagination the moment a Space held more than one page of rows.
 */

const SUPPORTED_TEXT = 'Supported formats: PDF, Word, Excel, PowerPoint, Images, '
  + 'ZIP, CSV, TXT, JSON, XML and other approved formats.'

const SORTS = [
  { value: 'uploaded', label: 'Uploaded date' },
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'File type' },
  { value: 'size', label: 'Size' },
  { value: 'modified', label: 'Modified date' },
]

const PAGE_SIZE = 25

export function SpaceDocuments({ spaceKey, canUpload, canManage }) {
  const [rows, setRows] = useState([])
  const [folders, setFolders] = useState([])
  const [storage, setStorage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  const [q, setQ] = useState('')
  const [folderId, setFolderId] = useState('')
  const [fileType, setFileType] = useState('')
  const [sort, setSort] = useState('uploaded')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [menu, setMenu] = useState({ anchor: null, row: null })

  /*
   * JL-169 — folder NAVIGATION, distinct from the folder filter it
   * replaces. Browsing is scoped to one folder at a time and shows its
   * subfolders; searching deliberately escapes that scope and spans the
   * whole Space, because "I cannot find my file" is usually answered by
   * looking everywhere rather than by guessing which folder it is in.
   */
  const [folderMenu, setFolderMenu] = useState({ anchor: null, folder: null })
  const [folderForm, setFolderForm] = useState(null)   // {folder} | {} to create
  const [folderToDelete, setFolderToDelete] = useState(null)
  const [moveDoc, setMoveDoc] = useState(null)
  const [versionsDoc, setVersionsDoc] = useState(null)
  const [renameDoc, setRenameDoc] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      /*
       * JL-169 — a search escapes the open folder.
       *
       * Scoping search to the current folder answers "I cannot find my file"
       * with "it is not here", which is true and useless. The folder is kept
       * in state rather than cleared, so clearing the search puts the reader
       * back where they were browsing instead of dumping them at the root.
       */
      const data = await fetchDocuments(spaceKey, {
        q, folderId: q ? '' : folderId, fileType, sort, limit: PAGE_SIZE, offset,
      })
      setRows(data?.items ?? [])
      setHasMore(Boolean(data?.hasMore))
      setStorage(data?.storage ?? null)
    } catch (err) {
      // JL-248: say what failed. An empty table reads as "there are no
      // documents", which is a different claim from "this did not load".
      setError(err?.message || 'Could not load documents.')
    } finally {
      setLoading(false)
    }
  }, [spaceKey, q, folderId, fileType, sort, offset])

  useEffect(() => { load() }, [load])

  const loadFolders = useCallback(async () => {
    try {
      const data = await fetchFolders(spaceKey)
      setFolders(Array.isArray(data) ? data : [])
    } catch {
      /* folders are optional — the document list still works flat */
    }
  }, [spaceKey])

  useEffect(() => { loadFolders() }, [loadFolders])

  /** The chain from the root down to `folderId`, for the breadcrumb. */
  const trail = useMemo(() => {
    const byId = new Map(folders.map((f) => [String(f.id), f]))
    const out = []
    let cursor = folderId && folderId !== 'root' ? byId.get(String(folderId)) : null
    // Bounded by the folder count: a parent cycle would otherwise hang the
    // render, and nothing in the schema forbids one.
    let guard = folders.length + 1
    while (cursor && guard-- > 0) {
      out.unshift(cursor)
      cursor = cursor.parent_folder_id ? byId.get(String(cursor.parent_folder_id)) : null
    }
    return out
  }, [folders, folderId])

  /** Folders sitting directly inside the one being viewed. */
  const childFolders = useMemo(() => {
    const parent = folderId && folderId !== 'root' ? String(folderId) : null
    return folders
      .filter((f) => String(f.parent_folder_id ?? '') === String(parent ?? ''))
      .sort((a, b) => a.folder_name.localeCompare(b.folder_name))
  }, [folders, folderId])

  /** Every folder, labelled with its full path — for the Move dialog. */
  const folderPaths = useMemo(() => {
    const byId = new Map(folders.map((f) => [String(f.id), f]))
    return folders.map((f) => {
      const parts = []
      let cursor = f
      let guard = folders.length + 1
      while (cursor && guard-- > 0) {
        parts.unshift(cursor.folder_name)
        cursor = cursor.parent_folder_id ? byId.get(String(cursor.parent_folder_id)) : null
      }
      return { ...f, path: parts.join(' / ') }
    }).sort((a, b) => a.path.localeCompare(b.path))
  }, [folders])

  function openFolder(id) {
    setOffset(0)
    setTyped('')
    setFolderId(id ? String(id) : '')
  }

  // Debounce the search so a query does not fire on every keystroke.
  const [typed, setTyped] = useState('')
  useEffect(() => {
    const t = setTimeout(() => { setOffset(0); setQ(typed) }, 300)
    return () => clearTimeout(t)
  }, [typed])

  const usedPercent = useMemo(() => {
    if (!storage?.limitBytes) return 0
    return Math.min(100, Math.round((storage.usedBytes / storage.limitBytes) * 100))
  }, [storage])

  async function handleRename() {
    const name = renameValue.trim()
    if (!name) return
    setActionError('')
    try {
      await updateDocument(renameDoc.id, { fileName: name })
      setRenameDoc(null)
      await load()
    } catch (err) {
      setActionError(err?.message || 'Could not rename that document.')
    }
  }

  async function handleDelete(row) {
    setActionError('')
    try {
      await deleteDocument(row.id)
      await load()
    } catch (err) {
      setActionError(err?.message || 'Could not delete that document.')
    }
  }

  /*
   * Downloads and previews go through an authenticated endpoint, so a plain
   * <a href> would arrive without the bearer token. Opening in a new tab with
   * the token in the URL would put a credential in history and in the server
   * log, so the bytes are fetched and handed to the browser as a blob instead.
   */
  async function openWithAuth(url, { download, filename } = {}) {
    setActionError('')
    try {
      const token = window.localStorage.getItem('jira_auth_token')
        || window.sessionStorage.getItem('jira_auth_token')
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Request failed (${res.status})`)
      }
      const blobUrl = URL.createObjectURL(await res.blob())
      if (download) {
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = filename || 'document'
        document.body.appendChild(a)
        a.click()
        a.remove()
      } else {
        window.open(blobUrl, '_blank', 'noopener')
      }
      // Revoking immediately would cancel the navigation the click just
      // started, so the handle is released once the browser has taken it.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
    } catch (err) {
      setActionError(err?.message || 'Could not open that document.')
    }
  }

  return (
    <div className="space-documents">
      <div className="space-documents-bar">
        <TextField
          id="document-search"
          label="Search documents"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          size="small"
          className="space-documents-search"
        />
        <TextField
          id="document-folder-filter"
          select
          label="Folder"
          value={folderId}
          onChange={(e) => { setOffset(0); setTyped(''); setFolderId(e.target.value) }}
          size="small"
        >
          <MenuItem value="">All folders</MenuItem>
          <MenuItem value="root">Not filed</MenuItem>
          {folderPaths.map((f) => (
            <MenuItem key={f.id} value={String(f.id)}>{f.path}</MenuItem>
          ))}
        </TextField>
        <TextField
          id="document-type-filter"
          label="Type"
          value={fileType}
          onChange={(e) => { setOffset(0); setFileType(e.target.value) }}
          size="small"
          placeholder="pdf"
        />
        <TextField
          id="document-sort"
          select
          label="Sort by"
          value={sort}
          onChange={(e) => { setOffset(0); setSort(e.target.value) }}
          size="small"
        >
          {SORTS.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
        </TextField>
        {canUpload && (
          <Button onClick={() => setFolderForm({})}>New folder</Button>
        )}
        {canUpload && (
          <Button variant="contained" onClick={() => setUploadOpen(true)}>Upload</Button>
        )}
      </div>

      {/* JL-169 — spec section 7: Documents > Project Documents > Requirements */}
      <nav className="space-documents-crumbs" aria-label="Folder path">
        <button type="button" className="space-documents-crumb" onClick={() => openFolder(null)}>
          Documents
        </button>
        {trail.map((f, i) => (
          <span key={f.id}>
            <span className="space-documents-crumb-sep" aria-hidden="true">/</span>
            <button
              type="button"
              className="space-documents-crumb"
              aria-current={i === trail.length - 1 ? 'page' : undefined}
              onClick={() => openFolder(f.id)}
            >
              {f.folder_name}
            </button>
          </span>
        ))}
      </nav>

      {q && (
        <p className="space-documents-scopenote">
          Showing matches from the whole Space, not just this folder.
        </p>
      )}

      {actionError && <ErrorState error={actionError} onRetry={load} />}

      {loading && <LoadingState label="Loading documents…" />}
      {!loading && error && <ErrorState error={error} onRetry={load} />}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          icon={<DocumentIcon size={40} />}
          title={q ? 'No documents match that search' : 'No documents yet'}
          description={q
            ? 'Try a different word, or clear the filters.'
            : `Files uploaded to this Space appear here. ${SUPPORTED_TEXT}`}
          action={canUpload && !q
            ? <Button variant="contained" onClick={() => setUploadOpen(true)}>Upload a document</Button>
            : null}
        />
      )}

      {/*
        * JL-169 — subfolders are listed above the documents, the way a file
        * browser does. They are hidden while searching: a result set that
        * spans the Space has no single parent, so folder rows in it would
        * be claiming a containment that is not being shown.
        */}
      {!loading && !error && !q && childFolders.length > 0 && (
        <ul className="space-documents-folders">
          {childFolders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="space-documents-folder"
                onClick={() => openFolder(f.id)}
              >
                <FolderIcon size={16} />
                <span className="space-documents-folder-name">{f.folder_name}</span>
              </button>
              {canUpload && (
                <Button
                  size="small"
                  aria-label={`Actions for folder ${f.folder_name}`}
                  onClick={(e) => setFolderMenu({ anchor: e.currentTarget, folder: f })}
                >
                  ⋮
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="space-documents-tablewrap">
          <table className="space-documents-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Size</th>
                <th>Uploaded by</th>
                <th>Modified</th>
                <th>Version</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="space-documents-name">
                      <DocumentIcon size={16} />
                      <span title={row.file_name}>{row.file_name}</span>
                    </span>
                  </td>
                  <td className="space-documents-type">{row.file_extension}</td>
                  <td>{formatBytes(row.file_size)}</td>
                  <td>{row.uploaded_by}</td>
                  <td><RelativeTime value={row.updated_at || row.uploaded_at} /></td>
                  <td>v{row.current_version}</td>
                  <td>
                    <Button
                      size="small"
                      aria-label={`Actions for ${row.file_name}`}
                      onClick={(e) => setMenu({ anchor: e.currentTarget, row })}
                    >
                      ⋮
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="space-documents-more">
          <Button onClick={() => setOffset(offset + PAGE_SIZE)}>Show more</Button>
        </div>
      )}

      {storage && (
        <p className="space-documents-storage">
          Storage: {formatBytes(storage.usedBytes)} used of {formatBytes(storage.limitBytes)}
          <LinearProgress
            variant="determinate"
            value={usedPercent}
            className="space-documents-storage-bar"
          />
        </p>
      )}

      <Menu
        anchorEl={menu.anchor}
        open={Boolean(menu.anchor)}
        onClose={() => setMenu({ anchor: null, row: null })}
      >
        <MenuItem
          onClick={() => {
            openWithAuth(documentPreviewUrl(menu.row.id))
            setMenu({ anchor: null, row: null })
          }}
        >
          View
        </MenuItem>
        <MenuItem
          onClick={() => {
            openWithAuth(documentDownloadUrl(menu.row.id), {
              download: true, filename: menu.row.file_name,
            })
            setMenu({ anchor: null, row: null })
          }}
        >
          Download
        </MenuItem>
        <MenuItem
          onClick={() => {
            setVersionsDoc(menu.row)
            setMenu({ anchor: null, row: null })
          }}
        >
          Version history
        </MenuItem>
        {canUpload && (
          <MenuItem
            onClick={() => {
              setRenameValue(menu.row.file_name)
              setRenameDoc(menu.row)
              setMenu({ anchor: null, row: null })
            }}
          >
            Rename
          </MenuItem>
        )}
        {canManage && (
          <MenuItem
            onClick={() => {
              setMoveDoc(menu.row)
              setMenu({ anchor: null, row: null })
            }}
          >
            Move
          </MenuItem>
        )}
        {canManage && (
          <MenuItem
            onClick={() => {
              const row = menu.row
              setMenu({ anchor: null, row: null })
              handleDelete(row)
            }}
          >
            Delete
          </MenuItem>
        )}
      </Menu>

      <Menu
        anchorEl={folderMenu.anchor}
        open={Boolean(folderMenu.anchor)}
        onClose={() => setFolderMenu({ anchor: null, folder: null })}
      >
        <MenuItem
          onClick={() => {
            setFolderForm({ folder: folderMenu.folder })
            setFolderMenu({ anchor: null, folder: null })
          }}
        >
          Rename
        </MenuItem>
        {canManage && (
          <MenuItem
            onClick={() => {
              setFolderToDelete(folderMenu.folder)
              setFolderMenu({ anchor: null, folder: null })
            }}
          >
            Delete
          </MenuItem>
        )}
      </Menu>

      <FolderFormDialog
        open={Boolean(folderForm)}
        spaceKey={spaceKey}
        folder={folderForm?.folder ?? null}
        parentFolderId={folderId && folderId !== 'root' ? Number(folderId) : null}
        onClose={() => setFolderForm(null)}
        onSaved={loadFolders}
      />

      <DeleteFolderDialog
        folder={folderToDelete}
        onClose={() => setFolderToDelete(null)}
        onDeleted={async () => {
          // Standing inside the folder that just went would leave the view
          // pointed at an id the server no longer knows.
          if (String(folderId) === String(folderToDelete?.id)) openFolder(null)
          await loadFolders()
          await load()
        }}
      />

      <MoveDocumentDialog
        document={moveDoc}
        folders={folderPaths}
        onClose={() => setMoveDoc(null)}
        onMoved={load}
      />

      <DocumentVersionsDialog
        document={versionsDoc}
        canRestore={canManage}
        canReplace={canUpload}
        onClose={() => setVersionsDoc(null)}
        onChanged={load}
        onDownload={(url, filename) => openWithAuth(url, { download: true, filename })}
      />

      <Dialog open={Boolean(renameDoc)} onClose={() => setRenameDoc(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename document</DialogTitle>
        <DialogContent>
          <TextField
            id="document-rename"
            label="File name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            fullWidth
            autoFocus
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDoc(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleRename} disabled={!renameValue.trim()}>
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      <DocumentUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        spaceKey={spaceKey}
        folderId={folderId && folderId !== 'root' ? folderId : null}
        maxFileBytes={storage?.maxFileBytes}
        supportedText={SUPPORTED_TEXT}
        onUploaded={load}
      />
    </div>
  )
}

export default SpaceDocuments
