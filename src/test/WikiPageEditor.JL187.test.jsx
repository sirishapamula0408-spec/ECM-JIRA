/**
 * JL-187 (fosasoft) — the Confluence-style page editor's behaviour:
 * autosave (debounced, reported, no draft until there is something to keep),
 * loading a published page's pending draft, Publish, Close, quick insert.
 *
 * The real TipTap editor runs here; only the network is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'

const { api, home } = vi.hoisted(() => ({
  api: {
    createWikiPage: vi.fn(),
    fetchWikiPage: vi.fn(),
    saveWikiDraft: vi.fn(),
    publishWikiPage: vi.fn(),
    fetchSpacePages: vi.fn(),
    fetchWikiTemplates: vi.fn(),
    fetchSpaces: vi.fn(),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
  },
  home: { spaces: [{ id: 7, key: 'ENG', name: 'Engineering' }], starredPages: [] },
}))

vi.mock('../api/wikiApi', () => ({
  createWikiPage: api.createWikiPage,
  fetchWikiPage: api.fetchWikiPage,
  saveWikiDraft: api.saveWikiDraft,
  publishWikiPage: api.publishWikiPage,
  fetchSpacePages: api.fetchSpacePages,
}))
vi.mock('../api/wikiTemplateApi', () => ({ fetchWikiTemplates: api.fetchWikiTemplates }))
vi.mock('../api/wikiHomeApi', () => ({ addFavorite: api.addFavorite, removeFavorite: api.removeFavorite }))
vi.mock('../api/spaceApi', () => ({ fetchSpaces: api.fetchSpaces }))
vi.mock('../api/wikiAttachmentApi', () => ({
  uploadPageAttachment: vi.fn(), fileToBase64: vi.fn(), attachmentDownloadUrl: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ authUser: { email: 'ann@x.com' } }) }))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ members: [{ id: 1, name: 'Ann Lee', email: 'ann@x.com' }] }),
}))
vi.mock('../components/wiki/VersionHistoryPanel', () => ({ VersionHistoryPanel: () => null }))

import { WikiPageEditor } from '../pages/WikiHomePage/WikiPageEditor'

// jsdom does no layout, so it has no getClientRects on a Range; ProseMirror
// calls it to scroll inserted content into view. An empty rect list is what
// a real browser returns for a collapsed, off-screen range.
const EMPTY_RECT = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null })
  Range.prototype.getBoundingClientRect ??= () => EMPTY_RECT
}

function Where() {
  const { pathname } = useLocation()
  return <p data-testid="where">{pathname}</p>
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={{ home, reloadHome: vi.fn(), onToggleSidebar: vi.fn() }} />}>
          {/* Exactly as App.jsx declares them: the same element on both. */}
          <Route path="/wiki/new" element={<WikiPageEditor />} />
          <Route path="/wiki/pages/:pageId/edit" element={<WikiPageEditor />} />
          <Route path="/wiki/pages/:pageId" element={<p>Page view</p>} />
          <Route path="/spaces/:key" element={<p>Space view</p>} />
        </Route>
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

const typeTitle = (value) => fireEvent.change(screen.getByLabelText('Page title'), { target: { value } })

beforeEach(() => {
  vi.clearAllMocks()
  api.createWikiPage.mockResolvedValue({ id: 42, status: 'draft', space_id: 7, parent_id: null, title: 'Plan', created_by: 'ann@x.com' })
  api.saveWikiDraft.mockResolvedValue({ id: 42, status: 'draft', savedAt: 'T' })
  api.publishWikiPage.mockResolvedValue({ id: 42, status: 'published', version: 1 })
  api.fetchSpacePages.mockResolvedValue([])
  api.fetchWikiTemplates.mockResolvedValue([])
  api.fetchSpaces.mockResolvedValue([...home.spaces, { id: 99, key: 'LATE', name: 'Zz late space' }])
})

describe('a new page', () => {
  it('shows the Confluence layout: Untitled, title placeholder, byline, quick insert', async () => {
    renderAt('/wiki/new?spaceId=7')
    expect(screen.getByText('Untitled')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Give this page a title')).toBeInTheDocument()
    expect(screen.getByText('By Ann Lee')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Troubleshooting article/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish…' })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument()
  })

  it('autosaves once typing stops, creating the draft only then', async () => {
    renderAt('/wiki/new?spaceId=7')
    typeTitle('P')
    typeTitle('Pl')
    typeTitle('Plan')
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
    expect(api.createWikiPage).not.toHaveBeenCalled()

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'), { timeout: 4000 })
    expect(api.createWikiPage).toHaveBeenCalledTimes(1)
    expect(api.createWikiPage).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 7, title: 'Plan', status: 'draft' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/wiki/pages/42/edit'))
    // The URL changed under the editor, but the editor was not remounted or
    // reloaded: what was typed is still there and nothing was refetched.
    expect(screen.getByLabelText('Page title')).toHaveValue('Plan')
    expect(api.fetchWikiPage).not.toHaveBeenCalled()
  })

  it('later edits autosave through the draft endpoint, not another create', async () => {
    renderAt('/wiki/new?spaceId=7')
    typeTitle('Plan')
    await waitFor(() => expect(api.createWikiPage).toHaveBeenCalledTimes(1), { timeout: 4000 })
    typeTitle('Plan B')
    await waitFor(() => expect(api.saveWikiDraft).toHaveBeenCalledWith(42, expect.objectContaining({ title: 'Plan B' })), { timeout: 4000 })
    expect(api.createWikiPage).toHaveBeenCalledTimes(1)
  })

  it('reports a failed save instead of looking saved', async () => {
    api.createWikiPage.mockRejectedValue(new Error('Space is archived'))
    renderAt('/wiki/new?spaceId=7')
    typeTitle('Plan')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Not saved'), { timeout: 4000 })
    expect(screen.getByText('Space is archived')).toBeInTheDocument()
  })

  it('Close on a page never saved goes back to its space', async () => {
    renderAt('/wiki/new?spaceId=7')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/spaces/ENG'))
    expect(api.createWikiPage).not.toHaveBeenCalled()
  })

  it('a template fills the empty page and the quick-insert panel goes away', async () => {
    renderAt('/wiki/new?spaceId=7')
    fireEvent.click(await screen.findByRole('button', { name: /How-to article/ }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Start with' })).not.toBeInTheDocument())
    expect(document.querySelector('.pe-content h2')?.textContent).toBe('Before you begin')
  })

  it('Publish confirms the title and space, publishes, and opens the page', async () => {
    renderAt('/wiki/new?spaceId=7')
    typeTitle('Release plan')
    fireEvent.click(screen.getByRole('button', { name: 'Publish…' }))
    const dialog = await screen.findByRole('dialog')
    expect(screen.getByTestId('publish-title')).toHaveValue('Release plan')
    await act(async () => { fireEvent.click(dialog.querySelector('button[type="submit"]')) })
    await waitFor(() => expect(api.publishWikiPage).toHaveBeenCalledWith(42, expect.objectContaining({
      title: 'Release plan', spaceId: 7, parentId: null,
    })))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/wiki/pages/42'))
  })
})

describe('JL-180 the space a page is started in', () => {
  it('is preselected for Publish even when the sidebar does not list it', async () => {
    renderAt('/wiki/new?spaceId=99')
    typeTitle('Late page')
    fireEvent.click(screen.getByRole('button', { name: 'Publish…' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.textContent).toContain('Zz late space'))
    await act(async () => { fireEvent.click(dialog.querySelector('button[type="submit"]')) })
    await waitFor(() => expect(api.publishWikiPage).toHaveBeenCalledWith(42, expect.objectContaining({ spaceId: 99 })))
    expect(api.createWikiPage).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 99 }))
  })
})

describe('editing a published page', () => {
  it('opens the pending draft rather than the published text, and says so', async () => {
    api.fetchWikiPage.mockResolvedValue({
      id: 5, status: 'published', space_id: 7, parent_id: null, created_by: 'ann@x.com', version: 3,
      title: 'Runbook', content: '<p>live text</p>',
      draft_title: 'Runbook v2', draft_content: '<p>pending text</p>', draft_updated_at: 'T', draft_updated_by: 'bob@x.com',
    })
    renderAt('/wiki/pages/5/edit')
    await waitFor(() => expect(screen.getByLabelText('Page title')).toHaveValue('Runbook v2'))
    await waitFor(() => expect(document.querySelector('.pe-content')?.textContent).toContain('pending text'))
    expect(screen.getByText(/unpublished changes by bob@x.com/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update…' })).toBeInTheDocument()
  })

  it('autosaves into the draft endpoint for that page', async () => {
    api.fetchWikiPage.mockResolvedValue({
      id: 5, status: 'published', space_id: 7, parent_id: null, created_by: 'ann@x.com', version: 3,
      title: 'Runbook', content: '<p>live</p>',
    })
    renderAt('/wiki/pages/5/edit')
    await waitFor(() => expect(screen.getByLabelText('Page title')).toHaveValue('Runbook'))
    typeTitle('Runbook (new)')
    await waitFor(() => expect(api.saveWikiDraft).toHaveBeenCalledWith(5, expect.objectContaining({ title: 'Runbook (new)' })), { timeout: 4000 })
    expect(api.createWikiPage).not.toHaveBeenCalled()
  })
})
