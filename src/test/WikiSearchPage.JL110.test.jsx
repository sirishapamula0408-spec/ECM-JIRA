import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'

/* ================================================================
   JL-110→114 — the search results page.

   The sharpest assertions are on the highlighting. Marking up a
   user's search term inside stored page content is the classic way
   an XSS gets reintroduced, so the excerpt arrives as TEXT plus
   offsets and this page renders elements around ranges. Nothing is
   parsed; there is no second markup-assembly path beside
   sanitizeHtml (JL-359).
   ================================================================ */

const { api } = vi.hoisted(() => ({ api: { searchWikiHomePages: vi.fn() } }))
vi.mock('../api/wikiSearchApi', () => api)

import { WikiSearchPage, Highlighted } from '../pages/WikiHomePage/WikiSearchPage'

const SPACES = [
  { id: 7, key: 'ENG', name: 'Engineering' },
  { id: 8, key: 'HR', name: 'People' },
]

const result = (over = {}) => ({
  total: 1,
  term: 'runbook',
  hasMore: false,
  nextCursor: null,
  items: [{
    id: 11,
    title: 'Deploy runbook',
    space_name: 'Engineering',
    space_key: 'ENG',
    updated_at: '2026-09-20T10:00:00Z',
    excerpt: { text: 'drain the queue first', ranges: [[0, 5]], truncatedStart: true, truncatedEnd: true },
  }],
  ...over,
})

function OutletHost() {
  return <Outlet context={{ home: { spaces: SPACES } }} />
}

function renderSearch(initial = '/wiki/search?q=runbook') {
  function Probe() {
    const { pathname, search } = useLocation()
    return <span data-testid="url">{pathname + search}</span>
  }
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Probe />
      <Routes>
        <Route path="/wiki" element={<OutletHost />}>
          <Route path="search" element={<WikiSearchPage />} />
        </Route>
        <Route path="/wiki/pages/:pageId" element={<div>page view</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.searchWikiHomePages.mockResolvedValue(result())
})

/* ---------------------------------------------------------------- *
 * Highlighting — rendered, never parsed
 * ---------------------------------------------------------------- */
describe('JL-112 Highlighted', () => {
  it('wraps the given range and leaves the rest alone', () => {
    const { container } = render(<Highlighted text="drain the queue" ranges={[[0, 5]]} />)
    expect(container.querySelector('mark').textContent).toBe('drain')
    expect(container.textContent).toBe('drain the queue')
  })

  it('renders markup in the excerpt as TEXT, never as elements', () => {
    /*
     * The excerpt is stripped server-side, but if anything ever slipped
     * through it must render as visible characters, not as a tag. This is the
     * assertion that would fail the day someone "improved" this to use
     * dangerouslySetInnerHTML.
     */
    const { container } = render(
      <Highlighted text={'<img src=x onerror=alert(1)> hi'} ranges={[]} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('marks every range, in order', () => {
    const { container } = render(<Highlighted text="a b a" ranges={[[0, 1], [4, 5]]} />)
    expect(container.querySelectorAll('mark')).toHaveLength(2)
  })

  it('degrades to plain text rather than throwing on a malformed range', () => {
    for (const ranges of [null, undefined, [[5, 1]], [[-9, 99]], ['nope'], [[1]]]) {
      const { container } = render(<Highlighted text="abc" ranges={ranges} />)
      expect(container.textContent).toContain('abc')
    }
  })

  it('does not drop text after the last range', () => {
    const { container } = render(<Highlighted text="abcdef" ranges={[[0, 2]]} />)
    expect(container.textContent).toBe('abcdef')
  })

  it('survives an empty excerpt', () => {
    const { container } = render(<Highlighted text="" ranges={[]} />)
    expect(container.textContent).toBe('')
  })
})

/* ---------------------------------------------------------------- *
 * The page
 * ---------------------------------------------------------------- */
describe('JL-110 results', () => {
  it('searches for the term in the URL, so a result list is linkable', async () => {
    renderSearch('/wiki/search?q=runbook')
    await waitFor(() => expect(api.searchWikiHomePages).toHaveBeenCalledWith('runbook', expect.any(Object)))
  })

  it('shows the total, not just the page size', async () => {
    api.searchWikiHomePages.mockResolvedValue(result({ total: 24, hasMore: true, nextCursor: 20 }))
    renderSearch()
    expect(await screen.findByText('24 results')).toBeInTheDocument()
  })

  it('renders the excerpt with the match marked', async () => {
    const { container } = renderSearch()
    await screen.findByText('Deploy runbook')
    expect(container.querySelector('.wiki-search-mark').textContent).toBe('drain')
  })

  it('shows the space so a hit is identifiable without opening it', async () => {
    renderSearch()
    expect(await screen.findByText(/Engineering/)).toBeInTheDocument()
  })

  it('opens the page when a result is clicked', async () => {
    renderSearch()
    fireEvent.click(await screen.findByText('Deploy runbook'))
    await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('/wiki/pages/11'))
  })

  it('says nothing matched rather than showing an empty list', async () => {
    api.searchWikiHomePages.mockResolvedValue(result({ items: [], total: 0 }))
    renderSearch()
    expect(await screen.findByText(/No pages match/)).toBeInTheDocument()
  })

  it('says the search FAILED rather than claiming nothing matched', async () => {
    // Two different statements; conflating them is JL-248.
    api.searchWikiHomePages.mockRejectedValue(new Error('search exploded'))
    renderSearch()
    // ErrorState prefixes its own title, so the message is part of a longer
    // string rather than an element of its own.
    expect(await screen.findByText(/search exploded/)).toBeInTheDocument()
    expect(screen.queryByText(/No pages match/)).not.toBeInTheDocument()
  })

  it('runs no search at all with an empty term', async () => {
    renderSearch('/wiki/search')
    await screen.findByText(/Search page titles/)
    expect(api.searchWikiHomePages).not.toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------------- *
 * JL-113 — narrowing by space
 * ---------------------------------------------------------------- */
describe('JL-113 space filter', () => {
  it('offers the spaces the shell already loaded, plus All', async () => {
    renderSearch()
    await screen.findByText('Deploy runbook')
    fireEvent.mouseDown(screen.getByLabelText('Space'))
    expect(await screen.findByText('All spaces')).toBeInTheDocument()
    expect(screen.getByText('Engineering')).toBeInTheDocument()
  })

  it('puts the chosen space in the URL, so a filtered list is linkable too', async () => {
    renderSearch()
    await screen.findByText('Deploy runbook')
    fireEvent.mouseDown(screen.getByLabelText('Space'))
    fireEvent.click(await screen.findByRole('option', { name: 'People' }))
    await waitFor(() => expect(screen.getByTestId('url').textContent).toContain('spaceId=8'))
  })

  it('passes the space to the server rather than filtering on the client', async () => {
    // Client-side filtering of a paged result would silently drop matches.
    renderSearch('/wiki/search?q=runbook&spaceId=7')
    await waitFor(() => {
      expect(api.searchWikiHomePages).toHaveBeenCalledWith('runbook', expect.objectContaining({ spaceId: '7' }))
    })
  })
})

/* ---------------------------------------------------------------- *
 * Paging
 * ---------------------------------------------------------------- */
describe('JL-110 paging', () => {
  it('offers more only when there is more', async () => {
    renderSearch()
    await screen.findByText('Deploy runbook')
    expect(screen.queryByRole('button', { name: /Show more results/ })).not.toBeInTheDocument()
  })

  it('appends the next page rather than replacing the list', async () => {
    api.searchWikiHomePages.mockResolvedValueOnce(result({ total: 2, hasMore: true, nextCursor: 20 }))
    api.searchWikiHomePages.mockResolvedValueOnce(result({
      total: 2,
      hasMore: false,
      nextCursor: null,
      items: [{
        id: 12, title: 'Rollback runbook', space_name: 'Engineering', space_key: 'ENG',
        updated_at: '2026-09-19T10:00:00Z',
        excerpt: { text: 'second hit', ranges: [], truncatedStart: false, truncatedEnd: false },
      }],
    }))
    renderSearch()
    fireEvent.click(await screen.findByRole('button', { name: /Show more results/ }))
    expect(await screen.findByText('Rollback runbook')).toBeInTheDocument()
    expect(screen.getByText('Deploy runbook')).toBeInTheDocument()
  })
})
