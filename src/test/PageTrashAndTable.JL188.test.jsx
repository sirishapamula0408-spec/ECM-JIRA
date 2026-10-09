/**
 * JL-188 (fosasoft) — deleting a Confluence Lite page (trash, restore,
 * undo) and the contextual table toolbar in the page editor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'

const { api } = vi.hoisted(() => ({
  api: {
    fetchWikiPage: vi.fn(),
    deleteWikiPage: vi.fn(),
    restoreWikiPage: vi.fn(),
    fetchWikiTrash: vi.fn(),
    createWikiPage: vi.fn(),
    saveWikiDraft: vi.fn(),
    publishWikiPage: vi.fn(),
    fetchSpacePages: vi.fn(),
    recordPageView: vi.fn(),
    fetchWikiList: vi.fn(),
    fetchSpace: vi.fn(),
    fetchSpaces: vi.fn(),
    fetchWikiTemplates: vi.fn(),
  },
}))

vi.mock('../api/wikiApi', () => ({
  fetchWikiPage: api.fetchWikiPage,
  deleteWikiPage: api.deleteWikiPage,
  restoreWikiPage: api.restoreWikiPage,
  fetchWikiTrash: api.fetchWikiTrash,
  createWikiPage: api.createWikiPage,
  saveWikiDraft: api.saveWikiDraft,
  publishWikiPage: api.publishWikiPage,
  fetchSpacePages: api.fetchSpacePages,
}))
vi.mock('../api/wikiHomeApi', () => ({
  recordPageView: api.recordPageView,
  fetchWikiList: api.fetchWikiList,
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}))
vi.mock('../api/spaceApi', () => ({ fetchSpace: api.fetchSpace, fetchSpaces: api.fetchSpaces }))
vi.mock('../api/wikiTemplateApi', () => ({ fetchWikiTemplates: api.fetchWikiTemplates }))
vi.mock('../api/wikiAttachmentApi', () => ({
  uploadPageAttachment: vi.fn(), fileToBase64: vi.fn(), attachmentDownloadUrl: vi.fn(),
}))
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ canCreateIssue: true }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ authUser: { email: 'ann@x.com' } }) }))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ members: [{ id: 1, name: 'Ann Lee', email: 'ann@x.com' }] }),
}))
vi.mock('../components/wiki/PageComments', () => ({ PageComments: () => null }))
vi.mock('../components/wiki/PageAttachments', () => ({ PageAttachments: () => null }))
vi.mock('../components/wiki/VersionHistoryPanel', () => ({ VersionHistoryPanel: () => null }))
vi.mock('../components/documents/SpaceDocuments', () => ({ SpaceDocuments: () => null }))

import { WikiPageViewer } from '../pages/WikiHomePage/WikiPageViewer'
import { WikiPageEditor } from '../pages/WikiHomePage/WikiPageEditor'
import { SpaceViewPage } from '../pages/SpacesPage/SpaceViewPage'

// jsdom does no layout; ProseMirror asks a Range for its rects when scrolling.
const EMPTY_RECT = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null })
Range.prototype.getBoundingClientRect ??= () => EMPTY_RECT

const SPACE = { id: 7, key: 'ENG', name: 'Engineering', myRole: 'Member', archived: false }
const home = { spaces: [SPACE], starredPages: [] }

function Where() {
  const { pathname } = useLocation()
  return <p data-testid="where">{pathname}</p>
}

function renderAt(path, state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path.split('?')[0], search: path.includes('?') ? `?${path.split('?')[1]}` : '', state }]}>
      <Routes>
        <Route element={<Outlet context={{ home, reloadHome: vi.fn(), onToggleSidebar: vi.fn() }} />}>
          <Route path="/wiki/pages/:pageId" element={<WikiPageViewer />} />
          <Route path="/wiki/new" element={<WikiPageEditor />} />
          <Route path="/wiki/pages/:pageId/edit" element={<WikiPageEditor />} />
          <Route path="/wiki/home" element={<p>Home</p>} />
          <Route path="/spaces/:spaceKey" element={<SpaceViewPage />} />
        </Route>
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

const PAGE = {
  id: 11, title: 'Deploy runbook', content: '<p>Step one</p>', status: 'published',
  space_id: 7, space_key: 'ENG', space_name: 'Engineering', updated_at: '2026-09-20T10:00:00Z',
  version: 2, children: [{ id: 12, title: 'Child' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchWikiPage.mockResolvedValue(PAGE)
  api.recordPageView.mockResolvedValue({})
  api.deleteWikiPage.mockResolvedValue({ success: true })
  api.restoreWikiPage.mockResolvedValue({ id: 11 })
  api.fetchSpace.mockResolvedValue(SPACE)
  api.fetchSpaces.mockResolvedValue([SPACE])
  api.fetchWikiList.mockResolvedValue({ items: [], hasMore: false })
  api.fetchWikiTrash.mockResolvedValue([])
  api.fetchWikiTemplates.mockResolvedValue([])
})

describe('JL-188 deleting a page from the page view', () => {
  async function openTrashConfirm() {
    renderAt('/wiki/pages/11')
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Move to trash/ }))
    return screen.findByRole('dialog')
  }

  it('asks first, naming the page, the trash, and what happens to child pages', async () => {
    const dialog = await openTrashConfirm()
    expect(dialog).toHaveTextContent('“Deploy runbook” will be moved to the trash')
    expect(dialog).toHaveTextContent('restore it from the Space’s Trash tab')
    expect(dialog).toHaveTextContent('Its 1 child page moves to the top level')
  })

  it('cancelling deletes nothing', async () => {
    const dialog = await openTrashConfirm()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.deleteWikiPage).not.toHaveBeenCalled()
  })

  it('confirming deletes it and lands on the Space with Undo', async () => {
    const dialog = await openTrashConfirm()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to trash' }))
    await waitFor(() => expect(api.deleteWikiPage).toHaveBeenCalledWith(11))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/spaces/ENG'))
    expect(await screen.findByText('“Deploy runbook” was moved to the trash.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(api.restoreWikiPage).toHaveBeenCalledWith(11))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/wiki/pages/11'))
  })

  it('shows the server’s refusal instead of navigating away', async () => {
    api.deleteWikiPage.mockRejectedValue(new Error('Wiki page not found'))
    const dialog = await openTrashConfirm()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to trash' }))
    expect(await screen.findByText('Wiki page not found')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/wiki/pages/11')
  })
})

describe('JL-188 the Space’s Trash tab', () => {
  it('lists deleted pages and restores one', async () => {
    api.fetchWikiTrash.mockResolvedValue([
      { id: 21, title: 'Old plan', deleted_at: '2026-10-01T00:00:00Z', deleted_by: 'bob@x.com' },
    ])
    renderAt('/spaces/ENG')
    fireEvent.click(await screen.findByRole('tab', { name: 'Trash' }))
    expect(await screen.findByText('Old plan')).toBeInTheDocument()
    expect(screen.getByText(/by bob@x.com/)).toBeInTheDocument()
    expect(api.fetchWikiTrash).toHaveBeenCalledWith(7)

    fireEvent.click(screen.getByRole('button', { name: 'Restore Old plan' }))
    await waitFor(() => expect(api.restoreWikiPage).toHaveBeenCalledWith(21))
    // The Space's page list refreshes; the Trash tab, and its confirmation,
    // must survive that rather than being swapped out for a spinner.
    await waitFor(() => expect(api.fetchWikiList).toHaveBeenCalledTimes(2))
    expect(api.fetchSpace).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('“Old plan” was restored.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Trash' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'Restore Old plan' })).not.toBeInTheDocument()
  })

  it('says so when the trash is empty', async () => {
    renderAt('/spaces/ENG')
    fireEvent.click(await screen.findByRole('tab', { name: 'Trash' }))
    expect(await screen.findByText('The trash is empty')).toBeInTheDocument()
  })

  it('offers no Restore to a Space viewer', async () => {
    api.fetchSpace.mockResolvedValue({ ...SPACE, myRole: 'Viewer' })
    api.fetchWikiTrash.mockResolvedValue([{ id: 21, title: 'Old plan', deleted_at: '2026-10-01T00:00:00Z' }])
    renderAt('/spaces/ENG')
    fireEvent.click(await screen.findByRole('tab', { name: 'Trash' }))
    expect(await screen.findByText('Old plan')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument()
  })
})

describe('JL-188 the editor’s table toolbar', () => {
  const rows = () => document.querySelectorAll('.pe-content table tr').length
  const cols = () => document.querySelector('.pe-content table tr')?.children.length ?? 0

  async function editorWithTable() {
    renderAt('/wiki/new?spaceId=7')
    await screen.findByRole('toolbar', { name: 'Formatting' })
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Formatting' })).getByRole('button', { name: 'Table' }))
    return screen.findByRole('toolbar', { name: 'Table' })
  }

  it('is hidden until the caret is in a table', async () => {
    renderAt('/wiki/new?spaceId=7')
    await screen.findByRole('toolbar', { name: 'Formatting' })
    expect(screen.queryByRole('toolbar', { name: 'Table' })).not.toBeInTheDocument()
  })

  it('inserts and deletes rows and columns', async () => {
    const bar = await editorWithTable()
    expect([rows(), cols()]).toEqual([3, 3])
    fireEvent.click(within(bar).getByRole('button', { name: 'Insert row below' }))
    await waitFor(() => expect(rows()).toBe(4))
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Table' })).getByRole('button', { name: 'Insert column to the right' }))
    await waitFor(() => expect(cols()).toBe(4))
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Table' })).getByRole('button', { name: 'Delete this row' }))
    await waitFor(() => expect(rows()).toBe(3))
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Table' })).getByRole('button', { name: 'Delete this column' }))
    await waitFor(() => expect(cols()).toBe(3))
  })

  it('toggles the header row and shows its state', async () => {
    const bar = await editorWithTable()
    const header = within(bar).getByRole('button', { name: /first row into headers/ })
    expect(header).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(header)
    await waitFor(() => expect(document.querySelectorAll('.pe-content th')).toHaveLength(0))
    expect(within(screen.getByRole('toolbar', { name: 'Table' })).getByRole('button', { name: /first row into headers/ }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('deletes the whole table, and the toolbar goes with it', async () => {
    const bar = await editorWithTable()
    fireEvent.click(within(bar).getByRole('button', { name: 'Delete the whole table' }))
    await waitFor(() => expect(document.querySelector('.pe-content table')).toBeNull())
    expect(screen.queryByRole('toolbar', { name: 'Table' })).not.toBeInTheDocument()
  })

  it('stays hidden when a page that ends in a table is opened, until someone edits', async () => {
    api.fetchWikiPage.mockResolvedValue({
      ...PAGE, content: '<p>Intro</p><table><tbody><tr><th><p>A</p></th></tr><tr><td><p>1</p></td></tr></tbody></table>',
    })
    renderAt('/wiki/pages/11/edit')
    await waitFor(() => expect(document.querySelector('.pe-content table')).toBeTruthy())
    expect(screen.queryByRole('toolbar', { name: 'Table' })).not.toBeInTheDocument()
  })

  it('offers no Move to trash for a page that was never saved', async () => {
    renderAt('/wiki/new?spaceId=7')
    expect(await screen.findByRole('button', { name: 'More actions' })).toBeDisabled()
  })
})
