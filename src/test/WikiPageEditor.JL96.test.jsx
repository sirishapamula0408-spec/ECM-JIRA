import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-96→103 — editing a Confluence Lite page.

   Covers: the stored format and its backward compatibility, autosave
   and the state it reports, and the concurrent-edit refusal. TipTap
   itself is mocked — it is exercised by its own suite, and a
   contenteditable in jsdom would test the mock, not the behaviour.
   ================================================================ */

const { mockApi, mockPerms, editorProps } = vi.hoisted(() => ({
  mockApi: { fetchWikiPage: vi.fn(), updateWikiPage: vi.fn(), recordPageView: vi.fn() },
  mockPerms: { current: { canCreateIssue: true } },
  // Captures what the page hands the editor, so the opt-ins can be asserted.
  editorProps: { current: null },
}))

vi.mock('../api/wikiApi', () => ({
  fetchWikiPage: mockApi.fetchWikiPage,
  updateWikiPage: mockApi.updateWikiPage,
}))
vi.mock('../api/wikiHomeApi', () => ({ recordPageView: mockApi.recordPageView }))
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => mockPerms.current }))
vi.mock('../components/editor/TipTapEditor', () => ({
  TipTapEditor: (props) => {
    editorProps.current = props
    return (
      <textarea
        data-testid="editor"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    )
  },
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
      </Routes>
    </MemoryRouter>,
  )
}

/** Open the editor and wait for the lazy chunk to resolve. */
async function startEditing() {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  return screen.findByTestId('editor')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mockPerms.current = { canCreateIssue: true }
  editorProps.current = null
  mockApi.fetchWikiPage.mockResolvedValue(PAGE)
  mockApi.updateWikiPage.mockResolvedValue({ ...PAGE, content: '<p>Step two</p>' })
  mockApi.recordPageView.mockResolvedValue({})
})

afterEach(() => { vi.useRealTimers() })

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
 * JL-98 / JL-101 — the editor opt-ins
 * ---------------------------------------------------------------- */
describe('JL-98/JL-101 pages get tables and images', () => {
  it('enables both for page content', async () => {
    await startEditing()
    expect(editorProps.current.tables).toBe(true)
    expect(editorProps.current.images).toBe(true)
  })

  it('hands the editor the stored content to start from', async () => {
    await startEditing()
    expect(editorProps.current.value).toBe('<p>Step one</p>')
  })
})

/* ---------------------------------------------------------------- *
 * JL-102 — autosave
 * ---------------------------------------------------------------- */
describe('JL-102 autosave', () => {
  it('does not save on every keystroke', async () => {
    const editor = await startEditing()
    fireEvent.change(editor, { target: { value: '<p>a</p>' } })
    fireEvent.change(editor, { target: { value: '<p>ab</p>' } })
    expect(mockApi.updateWikiPage).not.toHaveBeenCalled()
  })

  it('saves once the typing stops', async () => {
    const editor = await startEditing()
    fireEvent.change(editor, { target: { value: '<p>Step two</p>' } })
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => expect(mockApi.updateWikiPage).toHaveBeenCalledTimes(1))
    expect(mockApi.updateWikiPage.mock.calls[0][1].content).toBe('<p>Step two</p>')
  })

  it('reports unsaved, then saved — the user never triggered it, so it must say', async () => {
    const editor = await startEditing()
    fireEvent.change(editor, { target: { value: '<p>x</p>' } })
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('saves immediately when asked, without waiting out the debounce', async () => {
    const editor = await startEditing()
    fireEvent.change(editor, { target: { value: '<p>now</p>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockApi.updateWikiPage).toHaveBeenCalledTimes(1))
  })

  it('surfaces a save failure rather than looking saved', async () => {
    mockApi.updateWikiPage.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    const editor = await startEditing()
    fireEvent.change(editor, { target: { value: '<p>x</p>' } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(await screen.findByText('Save failed')).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- *
 * JL-103 — concurrent edits
 * ---------------------------------------------------------------- */
describe('JL-103 concurrent edit detection', () => {
  const conflict = () => Object.assign(new Error('That page was changed by someone else'), {
    status: 409,
    data: { currentVersion: 6, yourVersion: 4, editedBy: 'jo@x.com' },
  })

  it('sends the version the editor loaded', async () => {
    const editor = await startEditing()
    fireEvent.change(editor, { target: { value: '<p>x</p>' } })
    await vi.advanceTimersByTimeAsync(2000)
    await waitFor(() => expect(mockApi.updateWikiPage).toHaveBeenCalled())
    expect(mockApi.updateWikiPage.mock.calls[0][1].expectedVersion).toBe(4)
  })

  it('names who changed it', async () => {
    mockApi.updateWikiPage.mockRejectedValue(conflict())
    const editor = await startEditing()
    fireEvent.change(editor, { target: { value: '<p>x</p>' } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(await screen.findByText(/jo@x\.com changed this page/)).toBeInTheDocument()
  })

  it('keeps the author’s text in the editor — a refusal is not a reason to discard it', async () => {
    mockApi.updateWikiPage.mockRejectedValue(conflict())
    const editor = await startEditing()
    fireEvent.change(editor, { target: { value: '<p>my work</p>' } })
    await vi.advanceTimersByTimeAsync(2000)
    await screen.findByText(/changed this page/)
    expect(editorProps.current.value).toBe('<p>my work</p>')
  })

  it('offers a reload, which is the only thing that resolves it', async () => {
    mockApi.updateWikiPage.mockRejectedValue(conflict())
    const editor = await startEditing()
    fireEvent.change(editor, { target: { value: '<p>x</p>' } })
    await vi.advanceTimersByTimeAsync(2000)
    const reload = await screen.findByRole('button', { name: 'Reload' })
    fireEvent.click(reload)
    await waitFor(() => expect(mockApi.fetchWikiPage).toHaveBeenCalledTimes(2))
  })

  it('does not report a conflict as a generic save failure', async () => {
    mockApi.updateWikiPage.mockRejectedValue(conflict())
    const editor = await startEditing()
    fireEvent.change(editor, { target: { value: '<p>x</p>' } })
    await vi.advanceTimersByTimeAsync(2000)
    await screen.findByText(/changed this page/)
    expect(screen.queryByText('Save failed')).not.toBeInTheDocument()
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
