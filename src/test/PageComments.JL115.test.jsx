import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

/* ================================================================
   JL-115→119 — the comments panel.

   The UI decides nothing that matters: the server owns who may edit,
   who may delete and whether a reply nests. What these pin is that
   the controls SHOWN mirror those rules — a control the server would
   reject is noise, and a control hidden here is not a security
   boundary. Both have to be true at once.
   ================================================================ */

const { api, auth, perms } = vi.hoisted(() => ({
  api: {
    fetchPageComments: vi.fn(),
    addPageComment: vi.fn(),
    editPageComment: vi.fn(),
    deletePageComment: vi.fn(),
    resolvePageComment: vi.fn(),
  },
  auth: { current: { authUser: { email: 'me@x.com' } } },
  perms: { current: { canCreateIssue: true, isAdmin: false } },
}))

vi.mock('../api/wikiCommentApi', () => api)
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth.current }))
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => perms.current }))

import { PageComments } from '../components/wiki/PageComments'

const mine = {
  id: 5, page_id: 1, parent_id: null, author: 'me@x.com', body: 'why this way?',
  edited_at: null, resolved_at: null, resolved_by: null, created_at: '2026-09-01T00:00:00Z',
}
const theirs = { ...mine, id: 6, author: 'jo@x.com', body: 'because of the cascade' }

const payload = (threads) => ({
  threads,
  total: threads.reduce((n, t) => n + 1 + (t.replies?.length ?? 0), 0),
})

beforeEach(() => {
  vi.clearAllMocks()
  auth.current = { authUser: { email: 'me@x.com' } }
  perms.current = { canCreateIssue: true, isAdmin: false }
  api.fetchPageComments.mockResolvedValue(payload([{ ...mine, replies: [] }]))
  api.addPageComment.mockResolvedValue({})
  api.editPageComment.mockResolvedValue({})
  api.deletePageComment.mockResolvedValue({})
  api.resolvePageComment.mockResolvedValue({})
})

const rowFor = (text) => screen.getByText(text).closest('.wiki-comment')

describe('JL-116 reading', () => {
  it('shows the author and the time', async () => {
    render(<PageComments pageId={1} />)
    expect(await screen.findByText('why this way?')).toBeInTheDocument()
    expect(rowFor('why this way?').textContent).toMatch(/me/i)
  })

  it('renders comment text as TEXT, never as markup', async () => {
    /*
     * A comment is short prose; admitting HTML would mean a second sanitised
     * render path beside the page body for no gain (JL-359).
     */
    api.fetchPageComments.mockResolvedValue(
      payload([{ ...mine, body: '<img src=x onerror=alert(1)>', replies: [] }]),
    )
    const { container } = render(<PageComments pageId={1} />)
    await screen.findByText(/<img src=x/)
    expect(container.querySelector('img')).toBeNull()
  })

  it('discloses an edit', async () => {
    api.fetchPageComments.mockResolvedValue(
      payload([{ ...mine, edited_at: '2026-09-02T00:00:00Z', replies: [] }]),
    )
    render(<PageComments pageId={1} />)
    expect(await screen.findByText(/edited/)).toBeInTheDocument()
  })

  it('nests replies under their thread', async () => {
    api.fetchPageComments.mockResolvedValue(
      payload([{ ...mine, replies: [{ ...theirs, parent_id: 5 }] }]),
    )
    const { container } = render(<PageComments pageId={1} />)
    await screen.findByText('because of the cascade')
    expect(container.querySelector('.wiki-thread-replies')).toBeTruthy()
  })

  it('says loading FAILED rather than claiming nobody has commented', async () => {
    api.fetchPageComments.mockRejectedValue(new Error('comments exploded'))
    render(<PageComments pageId={1} />)
    expect(await screen.findByText(/comments exploded/)).toBeInTheDocument()
    expect(screen.queryByText('No comments yet.')).not.toBeInTheDocument()
  })

  it('says so plainly when there are none', async () => {
    api.fetchPageComments.mockResolvedValue(payload([]))
    render(<PageComments pageId={1} />)
    expect(await screen.findByText('No comments yet.')).toBeInTheDocument()
  })
})

describe('JL-115/117 writing', () => {
  it('posts a top-level comment', async () => {
    render(<PageComments pageId={1} />)
    fireEvent.change(await screen.findByLabelText('Add a comment'), { target: { value: 'a thought' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(api.addPageComment).toHaveBeenCalledWith(1, 'a thought', null))
  })

  it('will not post an empty or whitespace-only comment', async () => {
    render(<PageComments pageId={1} />)
    const box = await screen.findByLabelText('Add a comment')
    fireEvent.change(box, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled()
    expect(api.addPageComment).not.toHaveBeenCalled()
  })

  it('posts a reply against its thread', async () => {
    render(<PageComments pageId={1} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }))
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'because' } })
    fireEvent.click(within(screen.getByLabelText('Reply').closest('.wiki-comment-edit')).getByRole('button', { name: 'Reply' }))
    await waitFor(() => expect(api.addPageComment).toHaveBeenCalledWith(1, 'because', 5))
  })

  it('offers no compose box to someone who cannot comment', async () => {
    perms.current = { canCreateIssue: false, isAdmin: false }
    render(<PageComments pageId={1} />)
    await screen.findByText('why this way?')
    expect(screen.queryByLabelText('Add a comment')).not.toBeInTheDocument()
  })
})

describe('JL-118 the controls mirror the server’s rules', () => {
  it('offers Edit on my own comment', async () => {
    render(<PageComments pageId={1} />)
    await screen.findByText('why this way?')
    expect(within(rowFor('why this way?')).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('offers no Edit on someone else’s, even to an admin', async () => {
    /*
     * The server refuses this outright: an admin rewriting another person's
     * words under their byline is a misattribution. The UI must not offer a
     * control that would be rejected.
     */
    perms.current = { canCreateIssue: true, isAdmin: true }
    api.fetchPageComments.mockResolvedValue(payload([{ ...theirs, replies: [] }]))
    render(<PageComments pageId={1} />)
    await screen.findByText('because of the cascade')
    expect(within(rowFor('because of the cascade')).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('offers Delete on someone else’s TO an admin', async () => {
    perms.current = { canCreateIssue: true, isAdmin: true }
    api.fetchPageComments.mockResolvedValue(payload([{ ...theirs, replies: [] }]))
    render(<PageComments pageId={1} />)
    await screen.findByText('because of the cascade')
    expect(within(rowFor('because of the cascade')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('offers no Delete on someone else’s to an ordinary member', async () => {
    api.fetchPageComments.mockResolvedValue(payload([{ ...theirs, replies: [] }]))
    render(<PageComments pageId={1} />)
    await screen.findByText('because of the cascade')
    expect(within(rowFor('because of the cascade')).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('saves an edit', async () => {
    render(<PageComments pageId={1} />)
    await screen.findByText('why this way?')
    fireEvent.click(within(rowFor('why this way?')).getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Edit comment'), { target: { value: 'rephrased' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.editPageComment).toHaveBeenCalledWith(1, 5, 'rephrased'))
  })

  it('warns that replies go with the thread before deleting a root', async () => {
    render(<PageComments pageId={1} />)
    await screen.findByText('why this way?')
    fireEvent.click(within(rowFor('why this way?')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(/replies are deleted with it/i)).toBeInTheDocument()
    expect(api.deletePageComment).not.toHaveBeenCalled()
  })
})

describe('JL-119 resolving', () => {
  it('offers Resolve on a thread root', async () => {
    render(<PageComments pageId={1} />)
    expect(await screen.findByRole('button', { name: 'Resolve' })).toBeInTheDocument()
  })

  it('offers it on the root ONLY, never on a reply', async () => {
    // Resolution belongs to the thread; a reply claiming its own state would
    // contradict the conversation it sits in.
    api.fetchPageComments.mockResolvedValue(
      payload([{ ...mine, replies: [{ ...theirs, parent_id: 5 }] }]),
    )
    render(<PageComments pageId={1} />)
    await screen.findByText('because of the cascade')
    expect(screen.getAllByRole('button', { name: 'Resolve' })).toHaveLength(1)
  })

  it('resolves, and then offers to reopen', async () => {
    render(<PageComments pageId={1} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(api.resolvePageComment).toHaveBeenCalledWith(1, 5, true))

    api.fetchPageComments.mockResolvedValue(
      payload([{ ...mine, resolved_at: '2026-09-03T00:00:00Z', resolved_by: 'me@x.com', replies: [] }]),
    )
    render(<PageComments pageId={1} />)
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeInTheDocument()
  })

  it('shows who resolved it', async () => {
    api.fetchPageComments.mockResolvedValue(
      payload([{ ...mine, resolved_at: '2026-09-03T00:00:00Z', resolved_by: 'jo@x.com', replies: [] }]),
    )
    render(<PageComments pageId={1} />)
    expect(await screen.findByText(/Resolved by/)).toBeInTheDocument()
  })
})
