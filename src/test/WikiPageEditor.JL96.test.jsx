import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-96→103 — reading a Confluence Lite page.

   Covers: the stored format and its backward compatibility, and who is
   offered Edit. JL-187 moved editing out of this view into the full-page
   editor (WikiPageEditor.JL187.test.jsx covers autosave and publish), so
   the inline-editing cases that lived here went with it.
   ================================================================ */

const { mockApi, mockPerms } = vi.hoisted(() => ({
  mockApi: { fetchWikiPage: vi.fn(), recordPageView: vi.fn() },
  mockPerms: { current: { canCreateIssue: true } },
}))

vi.mock('../api/wikiApi', () => ({
  fetchWikiPage: mockApi.fetchWikiPage,
}))
vi.mock('../api/wikiHomeApi', () => ({ recordPageView: mockApi.recordPageView }))
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => mockPerms.current }))

/*
 * JL-115 mounted <PageComments> inside the viewer. Left unmocked its fetch
 * hangs under this file's fake timers and every case here times out — so the
 * comments panel is stubbed away. This file is about the PAGE; comments have
 * their own suite (PageComments.JL115) and testing them twice through a page
 * that merely contains them would assert nothing extra.
 */
vi.mock('../components/wiki/PageComments', () => ({
  PageComments: () => <div data-testid="page-comments" />,
}))
vi.mock('../components/wiki/PageAttachments', () => ({
  PageAttachments: () => <div data-testid="page-attachments" />,
}))
import { WikiPageViewer } from '../pages/WikiHomePage/WikiPageViewer'

const PAGE = {
  id: 11,
  title: 'Deploy runbook',
  space_name: 'Engineering',
  content: '<p>Step one</p>',
  status: 'published',
  updated_at: '2026-09-20T10:00:00Z',
  version: 4,
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/wiki/pages/11']}>
      <Routes>
        <Route path="/wiki/pages/:pageId" element={<WikiPageViewer />} />
        <Route path="/wiki/pages/:pageId/edit" element={<p>Editor route</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPerms.current = { canCreateIssue: true }
  mockApi.fetchWikiPage.mockResolvedValue(PAGE)
  mockApi.recordPageView.mockResolvedValue({})
})

/* ---------------------------------------------------------------- *
 * JL-76 — the stored format, and what came before it
 * ---------------------------------------------------------------- */
describe('JL-76 page content is sanitised HTML', () => {
  it('renders stored HTML as markup, not as text', async () => {
    const { container } = renderPage()
    await screen.findByText('Deploy runbook')
    await waitFor(() => expect(container.querySelector('.wiki-viewer-content p')).toBeTruthy())
    expect(container.querySelector('.wiki-viewer-content').textContent).toContain('Step one')
  })

  it('sanitises on the way OUT as well as in', async () => {
    /*
     * Content stored before JL-359 made sanitizeHtml the single gate has not
     * necessarily been through it. Rendering is the last point at which that
     * can be caught.
     */
    mockApi.fetchWikiPage.mockResolvedValue({
      ...PAGE, content: '<p>ok</p><script>alert(1)</script>',
    })
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('.wiki-viewer-content')).toBeTruthy())
    expect(container.innerHTML).not.toContain('<script')
    expect(container.innerHTML).not.toContain('alert(1)')
  })

  it('keeps line breaks in a page written before pages held HTML', async () => {
    mockApi.fetchWikiPage.mockResolvedValue({ ...PAGE, content: 'line one\nline two' })
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelector('pre.wiki-content-pre')).toBeTruthy())
    // Rendered as preformatted text, NOT parsed as markup.
    expect(container.querySelector('.wiki-viewer-content')).toBeNull()
  })
})

/* ---------------------------------------------------------------- *
 * Permissions
 * ---------------------------------------------------------------- */
describe('editing is gated', () => {
  it('offers no Edit control to someone who cannot write', async () => {
    mockPerms.current = { canCreateIssue: false }
    renderPage()
    await screen.findByText('Deploy runbook')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- *
 * JL-187 — editing happens in the full-page editor
 * ---------------------------------------------------------------- */
describe('JL-187 Edit opens the page editor', () => {
  it('goes to /wiki/pages/:id/edit instead of editing in place', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Editor route')).toBeInTheDocument()
  })

  it('tells an editor that unpublished changes are waiting', async () => {
    mockApi.fetchWikiPage.mockResolvedValue({ ...PAGE, draft_updated_at: '2026-10-09T10:00:00Z' })
    renderPage()
    expect(await screen.findByText('Unpublished changes')).toBeInTheDocument()
  })

  it('fills a table of contents from the page headings', async () => {
    mockApi.fetchWikiPage.mockResolvedValue({
      ...PAGE,
      content: '<div data-type="toc"></div><h2>Install</h2><p>a</p><h3>Verify</h3><p>b</p>',
    })
    const { container } = renderPage()
    await waitFor(() => expect(container.querySelectorAll('div[data-type="toc"] a')).toHaveLength(2))
    const links = [...container.querySelectorAll('div[data-type="toc"] a')]
    expect(links.map((a) => a.textContent)).toEqual(['Install', 'Verify'])
    expect(links[0].getAttribute('href')).toBe('#install')
    expect(container.querySelector('h2#install')).toBeTruthy()
  })
})
