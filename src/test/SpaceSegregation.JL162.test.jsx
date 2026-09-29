import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ================================================================
   JL-162 — pages are segregated by the Space they were created in.

   Before this, every list of pages was reader-centric: Recent (what
   I looked at), Starred (what I kept), the feed (what changed
   anywhere). Nothing answered "what is IN this Space", which is the
   question a Space exists to answer. Clicking a Space in the sidebar
   went to /spaces?key=ENG, and the directory page ignored the
   parameter outright — so choosing one Space showed you all of them.

   The assertion that matters most is the narrowing one: the view
   must ask the server for ONE Space's pages rather than fetching
   everything and filtering client-side. Filtering in the browser
   would mean pages from Spaces the caller cannot see travel to them
   first, which is the rule the whole of Confluence Lite is built
   around.
   ================================================================ */

const { spaceApi, homeApi } = vi.hoisted(() => ({
  spaceApi: { fetchSpace: vi.fn(), fetchSpaces: vi.fn(), createSpace: vi.fn(), deleteSpace: vi.fn() },
  homeApi: { fetchWikiList: vi.fn(), recordPageView: vi.fn() },
}))
vi.mock('../api/spaceApi', () => spaceApi)
vi.mock('../api/wikiHomeApi', () => homeApi)
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { email: 'jane@example.com' } }),
}))

import { SpaceViewPage } from '../pages/SpacesPage/SpaceViewPage'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(resolve(here, '..', p), 'utf8').replace(/\r\n/g, '\n')

const ENG = { id: 7, key: 'ENG', name: 'Engineering', description: 'Runbooks.', archived: false, myRole: 'Admin' }

const PAGES = [
  { id: 1, title: 'Deploy runbook', space_id: 7, modified_at: '2026-09-20T10:00:00Z' },
  { id: 2, title: 'On-call rota', space_id: 7, modified_at: '2026-09-19T10:00:00Z' },
]

function renderAt(key = 'ENG') {
  return render(
    <MemoryRouter initialEntries={[`/spaces/${key}`]}>
      <Routes>
        <Route path="/spaces/:spaceKey" element={<SpaceViewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  spaceApi.fetchSpace.mockResolvedValue(ENG)
  homeApi.fetchWikiList.mockResolvedValue({ kind: 'modified', items: PAGES, hasMore: false })
})

/* ---------------------------------------------------------------- *
 * The narrowing — the reason this ticket exists
 * ---------------------------------------------------------------- */
describe('JL-162 the Space view asks for ONE Space', () => {
  it('narrows the page list server-side, by spaceId', async () => {
    renderAt()
    await waitFor(() => expect(homeApi.fetchWikiList).toHaveBeenCalled())

    const [args] = homeApi.fetchWikiList.mock.calls[0]
    expect(args.spaceId, 'the request must carry the Space').toBe(7)
    // 'modified' is the pile that belongs to the Space rather than the reader;
    // it is also the only kind the endpoint narrows by spaceId.
    expect(args.kind).toBe('modified')
  })

  it('resolves the Space by KEY from the URL', async () => {
    renderAt('OPS')
    await waitFor(() => expect(spaceApi.fetchSpace).toHaveBeenCalledWith('OPS'))
  })

  it('lists that Space’s pages', async () => {
    renderAt()
    expect(await screen.findByText('Deploy runbook')).toBeInTheDocument()
    expect(screen.getByText('On-call rota')).toBeInTheDocument()
  })

  it('names the Space it is showing', async () => {
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Engineering' })).toBeInTheDocument()
    expect(screen.getByText('ENG')).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- *
 * States
 * ---------------------------------------------------------------- */
describe('JL-162 states', () => {
  it('offers to start the first page when the Space is empty', async () => {
    homeApi.fetchWikiList.mockResolvedValue({ items: [], hasMore: false })
    renderAt()
    expect(await screen.findByText(/No pages in this Space yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create the first page' })).toBeInTheDocument()
  })

  it('surfaces the server message rather than an empty list', async () => {
    /*
     * A Space the caller cannot see is a 404 by design — saying it exists but
     * is closed to you is itself a disclosure. Showing "no pages" instead
     * would claim something different and untrue (JL-248).
     */
    spaceApi.fetchSpace.mockRejectedValue(new Error('Space not found'))
    renderAt()
    expect(await screen.findByText(/Space not found/)).toBeInTheDocument()
    expect(screen.queryByText(/No pages in this Space yet/)).not.toBeInTheDocument()
  })

  it('does not offer to create a page in an ARCHIVED Space', async () => {
    // Archived Spaces stop accepting new pages (JL-84); offering the action
    // would just produce a rejection.
    spaceApi.fetchSpace.mockResolvedValue({ ...ENG, archived: true })
    homeApi.fetchWikiList.mockResolvedValue({ items: [], hasMore: false })
    renderAt()
    await screen.findByText(/No pages in this Space yet/)
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- *
 * The routes into it, read from source
 * ---------------------------------------------------------------- */
describe('JL-162 everything that names a Space can open it', () => {
  const app = read('App.jsx')
  const sidebar = read('components/wiki/WikiSidebar.jsx')
  const directory = read('pages/SpacesPage/SpacesPage.jsx')
  const viewer = read('pages/WikiHomePage/WikiPageViewer.jsx')

  it('registers /spaces/:spaceKey', () => {
    expect(app).toMatch(/<Route path=":spaceKey" element=\{<SpaceViewPage \/>\} \/>/)
  })

  it('keeps it inside the Confluence layout, not the Jira one (JL-155)', () => {
    const spacesAt = app.indexOf('path="/spaces"')
    const jiraAt = app.indexOf('<JiraLayout')
    expect(spacesAt).toBeGreaterThan(-1)
    expect(spacesAt).toBeLessThan(jiraAt)
  })

  it('points the sidebar row at the Space, not the directory', () => {
    expect(sidebar).toMatch(/navigate\(`\/spaces\/\$\{encodeURIComponent\(space\.key\)\}`\)/)
    // The old target silently listed every Space instead of the chosen one.
    expect(sidebar).not.toMatch(/\/spaces\?key=/)
  })

  it('makes the directory cards open their Space', () => {
    expect(directory).toMatch(/className="space-card-open"/)
    expect(directory).toMatch(/navigate\(`\/spaces\/\$\{encodeURIComponent\(space\.key\)\}`\)/)
  })

  it('links a page back to the Space it belongs to', () => {
    // A page that names its Space but cannot reach it is still a page on its
    // own. space_key comes from the join JL-158 added.
    expect(viewer).toMatch(/to=\{`\/spaces\/\$\{encodeURIComponent\(page\.space_key\)\}`\}/)
  })
})
