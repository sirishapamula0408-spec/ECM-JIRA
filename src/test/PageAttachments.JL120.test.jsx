import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

/* ================================================================
   JL-120→124 — the attachments panel.

   The UI decides nothing that matters: the server owns type, size
   and who may delete. What these pin is that the controls SHOWN
   mirror those rules, that a download goes through the API rather
   than straight to storage, and that a refusal is reported in the
   server's own words rather than restated here.
   ================================================================ */

const { api, auth, perms } = vi.hoisted(() => ({
  api: {
    fetchPageAttachments: vi.fn(),
    uploadPageAttachment: vi.fn(),
    deletePageAttachment: vi.fn(),
    downloadPageAttachment: vi.fn(),
    fileToBase64: vi.fn(),
    attachmentDownloadUrl: vi.fn(),
  },
  auth: { current: { authUser: { email: 'me@x.com' } } },
  perms: { current: { canCreateIssue: true, isAdmin: false } },
}))

vi.mock('../api/wikiAttachmentApi', () => api)
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth.current }))
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => perms.current }))

import { PageAttachments } from '../components/wiki/PageAttachments'

const mine = {
  id: 3, page_id: 1, filename: 'diagram.png', mime_type: 'image/png',
  size_bytes: 2048, uploaded_by: 'me@x.com', created_at: '2026-09-01T00:00:00Z',
}
const theirs = { ...mine, id: 4, filename: 'notes.pdf', uploaded_by: 'jo@x.com' }

const pickFile = (name = 'diagram.png', type = 'image/png') => {
  const input = document.getElementById('wiki-attachment-file')
  const file = new File(['bytes'], name, { type })
  fireEvent.change(input, { target: { files: [file] } })
  return file
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.current = { authUser: { email: 'me@x.com' } }
  perms.current = { canCreateIssue: true, isAdmin: false }
  api.fetchPageAttachments.mockResolvedValue([mine])
  api.uploadPageAttachment.mockResolvedValue({})
  api.deletePageAttachment.mockResolvedValue({})
  api.downloadPageAttachment.mockResolvedValue(undefined)
  api.fileToBase64.mockResolvedValue('YmFzZTY0')
})

describe('JL-121 listing', () => {
  it('shows the filename, size and who uploaded it', async () => {
    render(<PageAttachments pageId={1} />)
    expect(await screen.findByText('diagram.png')).toBeInTheDocument()
    const row = screen.getByText('diagram.png').closest('li')
    expect(row.textContent).toMatch(/2 KB/)
    expect(row.textContent).toMatch(/me/i)
  })

  it('says so plainly when nothing is attached', async () => {
    api.fetchPageAttachments.mockResolvedValue([])
    render(<PageAttachments pageId={1} />)
    expect(await screen.findByText('Nothing attached yet.')).toBeInTheDocument()
  })

  it('says loading FAILED rather than claiming nothing is attached', async () => {
    api.fetchPageAttachments.mockRejectedValue(new Error('attachments exploded'))
    render(<PageAttachments pageId={1} />)
    expect(await screen.findByText(/attachments exploded/)).toBeInTheDocument()
    expect(screen.queryByText('Nothing attached yet.')).not.toBeInTheDocument()
  })
})

describe('JL-120 uploading', () => {
  it('reads the file and uploads it', async () => {
    render(<PageAttachments pageId={1} />)
    await screen.findByText('diagram.png')
    pickFile('chart.png')
    await waitFor(() => {
      expect(api.uploadPageAttachment).toHaveBeenCalledWith(1, expect.objectContaining({
        filename: 'chart.png', mimeType: 'image/png', data: 'YmFzZTY0',
      }))
    })
  })

  it('reloads the list afterwards', async () => {
    render(<PageAttachments pageId={1} />)
    await screen.findByText('diagram.png')
    pickFile()
    await waitFor(() => expect(api.fetchPageAttachments).toHaveBeenCalledTimes(2))
  })

  it('reports a refusal in the SERVER’s words', async () => {
    /*
     * The server's message names the actual limit and the actual allow-list.
     * Restating either here would give two answers to "why was this refused"
     * that could drift apart.
     */
    api.uploadPageAttachment.mockRejectedValue(
      new Error('File type ".exe" is not allowed. Allowed types: png, jpg, pdf'),
    )
    render(<PageAttachments pageId={1} />)
    await screen.findByText('diagram.png')
    pickFile('payload.exe', 'application/x-msdownload')
    expect(await screen.findByText(/File type "\.exe" is not allowed/)).toBeInTheDocument()
  })

  it('lets the same file be picked twice in a row', async () => {
    // The input is reset on change; without that, re-picking fires nothing
    // and the upload silently does not happen.
    render(<PageAttachments pageId={1} />)
    await screen.findByText('diagram.png')
    pickFile('same.png')
    await waitFor(() => expect(api.uploadPageAttachment).toHaveBeenCalledTimes(1))
    pickFile('same.png')
    await waitFor(() => expect(api.uploadPageAttachment).toHaveBeenCalledTimes(2))
  })

  it('offers no upload control to someone who cannot write', async () => {
    perms.current = { canCreateIssue: false, isAdmin: false }
    render(<PageAttachments pageId={1} />)
    await screen.findByText('diagram.png')
    expect(screen.queryByRole('button', { name: /Attach a file/ })).not.toBeInTheDocument()
  })
})

describe('JL-122 downloading', () => {
  it('goes through the API rather than a bare storage link', async () => {
    /*
     * The endpoint needs a Bearer header an <a href> cannot send — and more
     * to the point, a URL the object store would serve directly is a
     * capability that outlives the permission that granted it.
     */
    render(<PageAttachments pageId={1} />)
    fireEvent.click(await screen.findByText('diagram.png'))
    await waitFor(() => expect(api.downloadPageAttachment).toHaveBeenCalledWith(1, 3, 'diagram.png'))
  })

  it('renders the name as a button, not an anchor to storage', async () => {
    render(<PageAttachments pageId={1} />)
    const name = await screen.findByText('diagram.png')
    expect(name.tagName).toBe('BUTTON')
    expect(name.getAttribute('href')).toBeNull()
  })

  it('surfaces a download failure', async () => {
    api.downloadPageAttachment.mockRejectedValue(new Error('That file is no longer stored'))
    render(<PageAttachments pageId={1} />)
    fireEvent.click(await screen.findByText('diagram.png'))
    expect(await screen.findByText(/no longer stored/)).toBeInTheDocument()
  })
})

describe('JL-124 deleting mirrors the server’s rule', () => {
  it('offers Delete on my own upload', async () => {
    render(<PageAttachments pageId={1} />)
    await screen.findByText('diagram.png')
    expect(within(screen.getByText('diagram.png').closest('li')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('offers none on someone else’s to an ordinary member', async () => {
    api.fetchPageAttachments.mockResolvedValue([theirs])
    render(<PageAttachments pageId={1} />)
    await screen.findByText('notes.pdf')
    expect(within(screen.getByText('notes.pdf').closest('li')).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('offers it on someone else’s TO an admin', async () => {
    perms.current = { canCreateIssue: true, isAdmin: true }
    api.fetchPageAttachments.mockResolvedValue([theirs])
    render(<PageAttachments pageId={1} />)
    await screen.findByText('notes.pdf')
    expect(within(screen.getByText('notes.pdf').closest('li')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('confirms before deleting, and says storage is affected', async () => {
    render(<PageAttachments pageId={1} />)
    await screen.findByText('diagram.png')
    fireEvent.click(within(screen.getByText('diagram.png').closest('li')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(/removed from the page and from storage/i)).toBeInTheDocument()
    expect(api.deletePageAttachment).not.toHaveBeenCalled()
  })

  it('deletes once confirmed', async () => {
    render(<PageAttachments pageId={1} />)
    await screen.findByText('diagram.png')
    fireEvent.click(within(screen.getByText('diagram.png').closest('li')).getByRole('button', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete', exact: true }))
    await waitFor(() => expect(api.deletePageAttachment).toHaveBeenCalledWith(1, 3))
  })
})
