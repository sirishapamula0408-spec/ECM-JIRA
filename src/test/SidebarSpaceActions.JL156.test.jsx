import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/* ================================================================
   JL-156 — create a Space from the sidebar's "+", delete one from
   the control beside it.

   Two assertions carry this suite.

   The first is structural: neither control may be nested INSIDE the
   row button it sits beside. A <button> within a <button> is invalid
   HTML and the browser silently drops one of them, so the markup
   that looks obvious renders one control, not two — and a test that
   only asked "is there a create button?" would pass against it.

   The second is the gate: the delete control appears only where the
   server said this caller administers that Space. Reading it off the
   payload rather than a context is deliberate (see WikiSidebar), and
   a regression here hands every Viewer a delete button that fails
   with a 403 they cannot act on.
   ================================================================ */

const { api } = vi.hoisted(() => ({
  api: { createSpace: vi.fn(), deleteSpace: vi.fn() },
}))
vi.mock('../api/spaceApi', () => api)

// useWikiSidebarState keys its expansion prefs per account, so the panel has
// needed AuthContext since JL-152. Mounting it bare is a test artefact, not a
// property of the component.
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { email: 'jane@example.com' } }),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}))

import { WikiSidebar } from '../components/wiki/WikiSidebar'

const ENG = { id: 1, key: 'ENG', name: 'Engineering', myRole: 'Admin' }
const OPS = { id: 2, key: 'OPS', name: 'Operations', myRole: 'Viewer' }

const payload = (over = {}) => ({
  canCreateSpace: true,
  recent: [],
  starredPages: [],
  spaces: [ENG, OPS],
  starredSpaces: [],
  ...over,
})

function mount(data = payload(), props = {}) {
  return render(
    <MemoryRouter>
      <WikiSidebar data={data} loading={false} {...props} />
    </MemoryRouter>,
  )
}

/** Expand the Spaces section, which is collapsed by default. */
async function openSpaces() {
  fireEvent.click(screen.getByRole('button', { name: /^Spaces$/ }))
  await screen.findByRole('button', { name: 'Engineering' })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

/* ---------------------------------------------------------------- *
 * The structural assertion
 * ---------------------------------------------------------------- */
describe('JL-156 the controls sit BESIDE their row, not inside it', () => {
  it('does not nest the "+" inside the Spaces toggle button', () => {
    mount()
    const toggle = screen.getByRole('button', { name: /^Spaces$/ })
    const plus = screen.getByRole('button', { name: 'Create a space' })
    // Invalid HTML, and the browser resolves it by dropping one of them.
    expect(toggle.contains(plus)).toBe(false)
    expect(plus.contains(toggle)).toBe(false)
  })

  it('does not nest a delete control inside its Space row button', async () => {
    mount()
    await openSpaces()
    const row = screen.getByRole('button', { name: 'Engineering' })
    const del = screen.getByRole('button', { name: 'Delete space Engineering' })
    expect(row.contains(del)).toBe(false)
  })

  it('keeps the toggle working with the "+" beside it', async () => {
    // The wrapper could easily swallow the click that expands the section.
    mount()
    const toggle = screen.getByRole('button', { name: /^Spaces$/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))
  })

  it('does not navigate when the delete control is clicked', async () => {
    // Both sit in the same row; a click that bubbled to the row would open the
    // Space AND the dialog.
    mount()
    await openSpaces()
    fireEvent.click(screen.getByRole('button', { name: 'Delete space Engineering' }))
    expect(navigate).not.toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------------- *
 * The gates
 * ---------------------------------------------------------------- */
describe('JL-156 who sees which control', () => {
  it('shows the "+" when the server says this caller may create', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Create a space' })).toBeInTheDocument()
  })

  it('hides the "+" when it says they may not', () => {
    mount(payload({ canCreateSpace: false }))
    expect(screen.queryByRole('button', { name: 'Create a space' })).not.toBeInTheDocument()
  })

  it('hides it when the payload has not arrived — fail closed', () => {
    mount(null)
    expect(screen.queryByRole('button', { name: 'Create a space' })).not.toBeInTheDocument()
  })

  it('offers delete only on a Space this caller administers', async () => {
    mount()
    await openSpaces()
    expect(screen.getByRole('button', { name: 'Delete space Engineering' })).toBeInTheDocument()
    // OPS is myRole: 'Viewer'.
    expect(screen.queryByRole('button', { name: 'Delete space Operations' })).not.toBeInTheDocument()
  })

  it('names the Space in the control, not just "Delete"', async () => {
    /*
     * Eight rows whose only accessible name is "Delete" are eight identical
     * controls to anyone not looking at the screen.
     */
    mount()
    await openSpaces()
    const labels = screen.getAllByRole('button', { name: /^Delete space / })
      .map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Delete space Engineering'])
  })
})

/* ---------------------------------------------------------------- *
 * Creating
 * ---------------------------------------------------------------- */
describe('JL-156 creating from the sidebar', () => {
  it('opens the shared create dialog', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Create a space' }))
    expect(screen.getByRole('heading', { name: 'Create a Space' })).toBeInTheDocument()
  })

  it('posts what was typed and refreshes the sidebar', async () => {
    const onSpacesChanged = vi.fn()
    api.createSpace.mockResolvedValue({ id: 3, key: 'HR', name: 'People' })
    mount(payload(), { onSpacesChanged })

    fireEvent.click(screen.getByRole('button', { name: 'Create a space' }))
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'People' } })
    fireEvent.change(screen.getByLabelText(/Key/), { target: { value: 'hr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.createSpace).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'People', key: 'HR' }),
    ))
    // Uppercased in the field, so what you see is what is stored.
    await waitFor(() => expect(onSpacesChanged).toHaveBeenCalled())
  })

  it('surfaces the SERVER message on a duplicate key', async () => {
    // The key rules live on the server; restating them here would let the two
    // drift. So the dialog must show what came back, not its own wording.
    api.createSpace.mockRejectedValue(new Error('A Space with the key ENG already exists'))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Create a space' }))
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Eng' } })
    fireEvent.change(screen.getByLabelText(/Key/), { target: { value: 'ENG' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('A Space with the key ENG already exists')).toBeInTheDocument()
    // And stays open, so the key can be corrected without retyping the rest.
    expect(screen.getByRole('heading', { name: 'Create a Space' })).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- *
 * Deleting
 * ---------------------------------------------------------------- */
describe('JL-156 deleting from the sidebar', () => {
  it('confirms by NAME before deleting', async () => {
    mount()
    await openSpaces()
    fireEvent.click(screen.getByRole('button', { name: 'Delete space Engineering' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: /Delete Engineering\?/ })).toBeInTheDocument()
    // Nothing has gone yet.
    expect(api.deleteSpace).not.toHaveBeenCalled()
  })

  it('does not delete when the confirmation is cancelled', async () => {
    mount()
    await openSpaces()
    fireEvent.click(screen.getByRole('button', { name: 'Delete space Engineering' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.deleteSpace).not.toHaveBeenCalled()
  })

  it('deletes on confirm and refreshes the sidebar', async () => {
    const onSpacesChanged = vi.fn()
    api.deleteSpace.mockResolvedValue({ ok: true })
    mount(payload(), { onSpacesChanged })
    await openSpaces()

    fireEvent.click(screen.getByRole('button', { name: 'Delete space Engineering' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteSpace).toHaveBeenCalledWith(1))
    await waitFor(() => expect(onSpacesChanged).toHaveBeenCalled())
  })

  it('keeps the dialog OPEN and shows why when the Space still holds pages', async () => {
    /*
     * This is the 409 the server returns rather than orphaning the pages. Its
     * message names the count and the alternative, and it is only useful if
     * the reader can still see which Space it was about — so the dialog must
     * not close on failure.
     */
    api.deleteSpace.mockRejectedValue(
      new Error('This Space still has 3 pages. Move or delete them first, or archive the Space to keep them.'),
    )
    mount()
    await openSpaces()
    fireEvent.click(screen.getByRole('button', { name: 'Delete space Engineering' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText(/still has 3 pages/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Delete Engineering\?/ })).toBeInTheDocument()
  })

  it('tells the reader that archiving is the non-destructive option', async () => {
    mount()
    await openSpaces()
    fireEvent.click(screen.getByRole('button', { name: 'Delete space Engineering' }))
    expect(within(screen.getByRole('dialog')).getByText(/archive it instead/i)).toBeInTheDocument()
  })
})
