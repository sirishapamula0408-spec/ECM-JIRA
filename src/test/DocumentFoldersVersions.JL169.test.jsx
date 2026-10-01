import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

/* ================================================================
   JL-169 / JL-170 — folder navigation and version history in the
   Documents tab.

   Two assertions carry this suite.

   The first is that browsing is SCOPED and searching is not. A
   folder view that quietly kept showing every document in the Space
   would make folders decorative; a search that stayed inside the
   current folder would answer "I cannot find my file" with "it is
   not here", which is the least useful true statement available.

   The second is that RESTORE APPENDS. The server implements it as a
   new version carrying the old bytes (the JL-108 shape), so the UI
   must not promise an undo. A reader who expects newer versions to
   disappear has been told the wrong thing about their data.
   ================================================================ */

const { api } = vi.hoisted(() => ({
  api: {
    fetchDocuments: vi.fn(),
    fetchFolders: vi.fn(),
    fetchDocumentVersions: vi.fn(),
    deleteDocument: vi.fn(),
    updateDocument: vi.fn(),
    restoreDocumentVersion: vi.fn(),
    replaceDocument: vi.fn(),
    createFolder: vi.fn(),
    updateFolder: vi.fn(),
    deleteFolder: vi.fn(),
    documentDownloadUrl: vi.fn((id, v) => `/api/documents/${id}/download${v ? `?versionId=${v}` : ''}`),
    documentPreviewUrl: vi.fn((id) => `/api/documents/${id}/preview`),
    uploadDocument: vi.fn(),
    formatBytes: (n) => `${n} B`,
  },
}))
vi.mock('../api/documentApi', () => api)

import { SpaceDocuments } from '../components/documents/SpaceDocuments'

const FOLDERS = [
  { id: 1, folder_name: 'Project Documents', parent_folder_id: null },
  { id: 2, folder_name: 'Requirements', parent_folder_id: 1 },
  { id: 3, folder_name: 'Archive', parent_folder_id: null },
]

const DOC = {
  id: 10,
  file_name: 'Requirements.docx',
  file_extension: 'docx',
  file_size: 4096,
  uploaded_by: 'jane@example.com',
  uploaded_at: '2026-09-20T10:00:00Z',
  updated_at: '2026-09-20T10:00:00Z',
  current_version: 3,
  folder_id: 2,
}

const page = (items = [DOC]) => ({
  items, hasMore: false, storage: { usedBytes: 1024, limitBytes: 10240, maxFileBytes: 1024 * 1024 },
})

function mount(props = {}) {
  return render(
    <SpaceDocuments spaceKey="ENG" canUpload canManage {...props} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchDocuments.mockResolvedValue(page())
  api.fetchFolders.mockResolvedValue(FOLDERS)
  api.fetchDocumentVersions.mockResolvedValue([
    { id: 30, version_number: 3, uploaded_by: 'jane@example.com', uploaded_at: '2026-09-20T10:00:00Z', file_size: 4096, change_comment: 'Signed off' },
    { id: 20, version_number: 2, uploaded_by: 'sam@example.com', uploaded_at: '2026-09-18T10:00:00Z', file_size: 3500, change_comment: 'Added scope' },
    { id: 10, version_number: 1, uploaded_by: 'sam@example.com', uploaded_at: '2026-09-17T10:00:00Z', file_size: 3000, change_comment: '' },
  ])
})

/* ---------------------------------------------------------------- *
 * Folder navigation
 * ---------------------------------------------------------------- */
describe('JL-169 folder navigation', () => {
  it('lists only the folders at the current level', async () => {
    mount()
    // Requirements is inside Project Documents, so it is not a root row.
    expect(await screen.findByRole('button', { name: 'Project Documents' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Requirements' })).not.toBeInTheDocument()
  })

  it('descends into a folder and scopes the listing to it', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Project Documents' }))

    await waitFor(() => {
      const last = api.fetchDocuments.mock.calls.at(-1)[1]
      expect(last.folderId, 'the request must be scoped to the folder').toBe('1')
    })
    // And its child folder is now the level being shown.
    expect(await screen.findByRole('button', { name: 'Requirements' })).toBeInTheDocument()
  })

  it('shows a breadcrumb trail down to the open folder', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Project Documents' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Requirements' }))

    const crumbs = screen.getByRole('navigation', { name: 'Folder path' })
    const labels = within(crumbs).getAllByRole('button').map((b) => b.textContent)
    expect(labels).toEqual(['Documents', 'Project Documents', 'Requirements'])
  })

  it('marks the open folder as the current crumb', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Project Documents' }))
    const crumbs = screen.getByRole('navigation', { name: 'Folder path' })
    const current = within(crumbs).getByRole('button', { name: 'Project Documents' })
    expect(current).toHaveAttribute('aria-current', 'page')
  })

  it('climbs back out via a crumb', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Project Documents' }))
    await screen.findByRole('button', { name: 'Requirements' })

    const crumbs = screen.getByRole('navigation', { name: 'Folder path' })
    fireEvent.click(within(crumbs).getByRole('button', { name: 'Documents' }))

    await waitFor(() => {
      const last = api.fetchDocuments.mock.calls.at(-1)[1]
      expect(last.folderId).toBe('')
    })
  })

  it('searches the whole Space, not only the open folder', async () => {
    /*
     * Deliberate. Scoping search to the current folder answers "I cannot find
     * my file" with "it is not here", which is true and useless.
     */
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Project Documents' }))
    fireEvent.change(screen.getByLabelText('Search documents'), { target: { value: 'spec' } })

    await waitFor(() => {
      const last = api.fetchDocuments.mock.calls.at(-1)[1]
      expect(last.q).toBe('spec')
      expect(last.folderId, 'search escapes the folder scope').toBe('')
    }, { timeout: 2000 })
    expect(screen.getByText(/whole Space, not just this folder/)).toBeInTheDocument()
  })

  it('hides folder rows while searching', async () => {
    mount()
    fireEvent.change(screen.getByLabelText('Search documents'), { target: { value: 'spec' } })
    await waitFor(() => expect(screen.getByText(/whole Space/)).toBeInTheDocument(), { timeout: 2000 })
    // A flat result set spans folders, so folder rows would imply a
    // containment the view is not showing.
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- *
 * Folder management
 * ---------------------------------------------------------------- */
describe('JL-169 folder management', () => {
  it('creates a folder inside the one being viewed', async () => {
    api.createFolder.mockResolvedValue({ id: 9 })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Project Documents' }))
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText(/Folder name/), { target: { value: 'Design' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.createFolder).toHaveBeenCalledWith(
      'ENG',
      expect.objectContaining({ folderName: 'Design', parentFolderId: 1 }),
    ))
  })

  it('surfaces the server message when a name is taken', async () => {
    api.createFolder.mockRejectedValue(new Error('A folder named "Design" already exists here'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText(/Folder name/), { target: { value: 'Design' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText(/already exists here/)).toBeInTheDocument()
  })

  it('keeps the delete dialog open on the still-holds-documents refusal', async () => {
    // The 409 names the count; closing would leave the message with no
    // indication of which folder it was about.
    api.deleteFolder.mockRejectedValue(new Error('This folder still holds 3 documents. Move or delete them first.'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for folder Archive' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText(/still holds 3 documents/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Delete Archive\?/ })).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- *
 * Version history
 * ---------------------------------------------------------------- */
describe('JL-169 version history', () => {
  const openVersions = async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: `Actions for ${DOC.file_name}` }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Version history' }))
    return screen.findByRole('dialog')
  }

  it('lists every version, newest first, and marks the current one', async () => {
    const dialog = await openVersions()
    const rows = within(dialog).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.querySelector('td').textContent.replace('Current', '').trim()))
      .toEqual(['v3', 'v2', 'v1'])
    expect(within(rows[0]).getByText('Current')).toBeInTheDocument()
  })

  it('shows the change comment, which is the only record of why', async () => {
    const dialog = await openVersions()
    expect(within(dialog).getByText('Signed off')).toBeInTheDocument()
    expect(within(dialog).getByText('Added scope')).toBeInTheDocument()
  })

  it('downloads a specific version by id, not just the current file', async () => {
    const dialog = await openVersions()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download version 2' }))
    expect(api.documentDownloadUrl).toHaveBeenCalledWith(DOC.id, 20)
  })

  it('offers restore on older versions but not on the current one', async () => {
    const dialog = await openVersions()
    expect(within(dialog).getByRole('button', { name: 'Restore version 2' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Restore version 1' })).toBeInTheDocument()
    // Restoring what is already current would add a version for no change.
    expect(within(dialog).queryByRole('button', { name: 'Restore version 3' })).not.toBeInTheDocument()
  })

  it('restores by version id and refreshes', async () => {
    api.restoreDocumentVersion.mockResolvedValue({ ok: true })
    const dialog = await openVersions()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore version 1' }))
    await waitFor(() => expect(api.restoreDocumentVersion).toHaveBeenCalledWith(DOC.id, 10))
  })

  it('says that restoring APPENDS rather than rewinds', async () => {
    /*
     * The server keeps every version and adds the restored bytes on top
     * (JL-108's shape). "Restore" reads like an undo, so the dialog has to
     * correct that expectation or it is describing someone else's data model.
     */
    const dialog = await openVersions()
    expect(within(dialog).getByText(/adds the chosen file back as a new version/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/Nothing is deleted/i)).toBeInTheDocument()
  })

  it('hides restore from someone who cannot manage the Space', async () => {
    render(<SpaceDocuments spaceKey="ENG" canUpload canManage={false} />)
    fireEvent.click(await screen.findByRole('button', { name: `Actions for ${DOC.file_name}` }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Version history' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: /^Restore version/ })).not.toBeInTheDocument()
    // Downloading an old version stays available — Viewers may read.
    expect(within(dialog).getByRole('button', { name: 'Download version 2' })).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- *
 * Move
 * ---------------------------------------------------------------- */
describe('JL-169 moving a document', () => {
  it('moves into a folder by id', async () => {
    api.updateDocument.mockResolvedValue({ ok: true })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: `Actions for ${DOC.file_name}` }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialog).getByLabelText(/Destination/))
    fireEvent.click(await screen.findByRole('option', { name: 'Archive' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))

    await waitFor(() => expect(api.updateDocument).toHaveBeenCalledWith(DOC.id, { folderId: 3 }))
  })

  it('can take a document out of every folder', async () => {
    // folder_id is nullable: belonging to no folder is a real state.
    api.updateDocument.mockResolvedValue({ ok: true })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: `Actions for ${DOC.file_name}` }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialog).getByLabelText(/Destination/))
    fireEvent.click(await screen.findByRole('option', { name: 'Not filed' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))

    await waitFor(() => expect(api.updateDocument).toHaveBeenCalledWith(DOC.id, { folderId: null }))
  })

  it('offers Move only to someone who may manage the Space', async () => {
    render(<SpaceDocuments spaceKey="ENG" canUpload canManage={false} />)
    fireEvent.click(await screen.findByRole('button', { name: `Actions for ${DOC.file_name}` }))
    expect(screen.queryByRole('menuitem', { name: 'Move' })).not.toBeInTheDocument()
    // Renaming is a Member action, so it stays.
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
  })
})
