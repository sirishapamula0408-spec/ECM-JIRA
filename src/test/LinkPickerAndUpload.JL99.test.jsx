import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { useRef } from 'react'

/* ================================================================
   JL-99 — pick a link target by title.
   JL-101 — upload an image from the editor.

   The sharpest assertion is on what gets STORED. An uploaded image
   must persist as the canonical relative URL, never as a blob: or a
   data: URI: the first dies with the browser session, the second is
   stripped by the sanitiser's scheme allow-list, and both would look
   fine in the editor and be gone on reload.
   ================================================================ */

const { search, attach } = vi.hoisted(() => ({
  search: { searchWikiHomePages: vi.fn() },
  attach: {
    uploadPageAttachment: vi.fn(),
    fileToBase64: vi.fn(),
    attachmentDownloadUrl: vi.fn((pageId, id) => `/api/wiki/${pageId}/attachments/${id}/download`),
  },
}))

vi.mock('../api/wikiSearchApi', () => search)
vi.mock('../api/wikiAttachmentApi', () => attach)

import { PageLinkDialog } from '../components/wiki/PageLinkDialog'
import { useAuthedImages } from '../hooks/useAuthedImages'

const HIT = { id: 42, title: 'Deploy runbook', space_name: 'Engineering' }

beforeEach(() => {
  vi.clearAllMocks()
  search.searchWikiHomePages.mockResolvedValue({ items: [HIT] })
})

/* ---------------------------------------------------------------- *
 * JL-99 — the picker
 * ---------------------------------------------------------------- */
describe('JL-99 link picker', () => {
  const open = (props = {}) =>
    render(<PageLinkDialog open onCancel={vi.fn()} onConfirm={vi.fn()} {...props} />)

  it('searches by title as you type', async () => {
    open()
    fireEvent.change(screen.getByLabelText(/Paste a URL/), { target: { value: 'runbook' } })
    await waitFor(() => expect(search.searchWikiHomePages).toHaveBeenCalledWith('runbook', { limit: 8 }))
    expect(await screen.findByText('Deploy runbook')).toBeInTheDocument()
  })

  it('inserts a RELATIVE url for a picked page', async () => {
    /*
     * Relative because sanitizeHtml permits relative URLs but not arbitrary
     * absolute ones, and because the link keeps working if the deployment
     * moves host.
     */
    const onConfirm = vi.fn()
    open({ onConfirm })
    fireEvent.change(screen.getByLabelText(/Paste a URL/), { target: { value: 'runbook' } })
    fireEvent.click(await screen.findByText('Deploy runbook'))
    expect(onConfirm).toHaveBeenCalledWith('/wiki/pages/42')
  })

  it('does NOT search something that is already a destination', async () => {
    // Searching for "https://example.com" returns nothing and would imply the
    // URL was wrong, which it is not.
    open()
    for (const value of ['https://example.com', '/wiki/pages/1', '#anchor', 'mailto:a@b.c']) {
      fireEvent.change(screen.getByLabelText(/Paste a URL/), { target: { value } })
      await new Promise((r) => setTimeout(r, 320))
    }
    expect(search.searchWikiHomePages).not.toHaveBeenCalled()
  })

  it('uses a typed URL as-is', async () => {
    const onConfirm = vi.fn()
    open({ onConfirm })
    fireEvent.change(screen.getByLabelText(/Paste a URL/), { target: { value: 'https://example.com/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(onConfirm).toHaveBeenCalledWith('https://example.com/x')
  })

  it('treats an empty box as REMOVE the link, not as cancel', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    open({ onConfirm, onCancel, initialHref: 'https://old.example' })
    fireEvent.change(screen.getByLabelText(/Paste a URL/), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Remove link' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))
    expect(onConfirm).toHaveBeenCalledWith('')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('stays usable when the search fails', async () => {
    // The dialog's primary job is still to accept a URL.
    search.searchWikiHomePages.mockRejectedValue(new Error('down'))
    open()
    fireEvent.change(screen.getByLabelText(/Paste a URL/), { target: { value: 'runbook' } })
    await waitFor(() => expect(search.searchWikiHomePages).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Use this' })).toBeEnabled()
  })
})

/* ---------------------------------------------------------------- *
 * JL-101 — image hydration
 * ---------------------------------------------------------------- */
describe('JL-101 authenticated images are hydrated for display', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    window.localStorage.setItem('jira_auth_token', 'tok')
    global.URL.createObjectURL = vi.fn(() => 'blob:fake')
    global.URL.revokeObjectURL = vi.fn()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['x']) })
  })

  afterEach(() => {
    global.fetch = originalFetch
    window.localStorage.clear()
  })

  /** Mount a container holding `html` and run the hook over it. */
  function hydrate(html) {
    const host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    const { unmount } = renderHook(() => {
      const ref = useRef(host)
      useAuthedImages(ref, [html])
    })
    return { host, unmount }
  }

  it('fetches our API images WITH the bearer header', async () => {
    // An <img src> cannot send one, which is the whole reason this exists.
    const { host } = hydrate('<img src="/api/wiki/1/attachments/3/download">')
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/wiki/1/attachments/3/download')
    expect(opts.headers.Authorization).toBe('Bearer tok')
    expect(host).toBeTruthy()
  })

  it('swaps in a blob URL so the image actually renders', async () => {
    const { host } = hydrate('<img src="/api/wiki/1/attachments/3/download">')
    await waitFor(() => expect(host.querySelector('img').getAttribute('src')).toBe('blob:fake'))
  })

  it('keeps the CANONICAL url on the element', async () => {
    // The stored content keeps the relative URL; the DOM must not lose it.
    const { host } = hydrate('<img src="/api/wiki/1/attachments/3/download">')
    await waitFor(() => expect(host.querySelector('img').getAttribute('data-src'))
      .toBe('/api/wiki/1/attachments/3/download'))
  })

  it('leaves external images alone', async () => {
    const { host } = hydrate('<img src="https://example.com/a.png">')
    await new Promise((r) => setTimeout(r, 20))
    expect(global.fetch).not.toHaveBeenCalled()
    expect(host.querySelector('img').getAttribute('src')).toBe('https://example.com/a.png')
  })

  it('leaves a failed image visibly broken rather than hiding it', async () => {
    /*
     * Silently removing it would hide from the author that their image is
     * gone — which they can still fix, but only if they can see it.
     */
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    const { host } = hydrate('<img src="/api/wiki/1/attachments/9/download">')
    await new Promise((r) => setTimeout(r, 20))
    expect(host.querySelector('img')).toBeTruthy()
    expect(host.querySelector('img').getAttribute('src')).toBe('/api/wiki/1/attachments/9/download')
  })

  it('revokes its blobs on unmount', async () => {
    const { unmount } = hydrate('<img src="/api/wiki/1/attachments/3/download">')
    await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled())
    unmount()
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })
})
