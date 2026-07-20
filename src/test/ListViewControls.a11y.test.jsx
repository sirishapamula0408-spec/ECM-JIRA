import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/* ================================================================
   JL-260 — ListViewControls accessibility + error/loading +
   in-app delete confirmation
   ================================================================ */

const {
  mockFetchListViews,
  mockCreateListView,
  mockUpdateListView,
  mockDeleteListView,
} = vi.hoisted(() => ({
  mockFetchListViews: vi.fn(),
  mockCreateListView: vi.fn(),
  mockUpdateListView: vi.fn(),
  mockDeleteListView: vi.fn(),
}))

vi.mock('../api/listViewApi', () => ({
  fetchListViews: mockFetchListViews,
  createListView: mockCreateListView,
  updateListView: mockUpdateListView,
  deleteListView: mockDeleteListView,
  DEFAULT_COLUMNS: ['key', 'summary', 'status', 'priority', 'assignee', 'updated'],
  COLUMN_LABELS: {
    key: 'Key',
    summary: 'Summary',
    status: 'Status',
    priority: 'Priority',
    assignee: 'Assignee',
    reporter: 'Reporter',
    updated: 'Updated',
  },
}))

import { ListViewControls } from '../components/listViews/ListViewControls'

function renderControls(props = {}) {
  const onColumnsChange = vi.fn()
  const utils = render(
    <ListViewControls
      columns={['key', 'summary', 'status']}
      onColumnsChange={onColumnsChange}
      {...props}
    />
  )
  return { onColumnsChange, ...utils }
}

describe('ListViewControls — a11y & UX (JL-260)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchListViews.mockResolvedValue([])
    mockDeleteListView.mockResolvedValue({})
    mockUpdateListView.mockResolvedValue({})
  })

  it('dropdown triggers expose aria-haspopup and aria-expanded', async () => {
    renderControls()
    const columnsBtn = screen.getByRole('button', { name: /columns/i })
    expect(columnsBtn).toHaveAttribute('aria-haspopup', 'menu')
    expect(columnsBtn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(columnsBtn)
    expect(columnsBtn).toHaveAttribute('aria-expanded', 'true')
  })

  it('visible-column checkbox toggles via onChange (keyboard-operable, not readOnly)', async () => {
    const { onColumnsChange } = renderControls()
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))

    // A selected column's checkbox should be checked and NOT readOnly
    const summaryCheckbox = screen.getByRole('checkbox', { name: /summary/i })
    expect(summaryCheckbox).toBeChecked()
    expect(summaryCheckbox).not.toHaveAttribute('readonly')

    // Firing change (what keyboard Space produces) toggles the column off
    fireEvent.click(summaryCheckbox)
    expect(onColumnsChange).toHaveBeenCalledWith(['key', 'status'])
  })

  it('reorder buttons have accessible names', async () => {
    renderControls()
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    expect(screen.getByRole('button', { name: /move key up/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /move key down/i })).toBeInTheDocument()
  })

  it('set-default and delete icon buttons have accessible names', async () => {
    mockFetchListViews.mockResolvedValue([
      { id: 1, name: 'My View', columns: ['key', 'summary'], isDefault: false },
    ])
    renderControls()
    fireEvent.click(screen.getByRole('button', { name: /^views$/i }))

    await screen.findByRole('button', { name: /set "my view" as default view/i })
    expect(screen.getByRole('button', { name: /delete view "my view"/i })).toBeInTheDocument()
  })

  it('delete uses an in-app confirm dialog (not window.confirm)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    mockFetchListViews.mockResolvedValue([
      { id: 5, name: 'Doomed', columns: ['key'], isDefault: false },
    ])
    renderControls()
    fireEvent.click(screen.getByRole('button', { name: /^views$/i }))

    const delBtn = await screen.findByRole('button', { name: /delete view "doomed"/i })
    fireEvent.click(delBtn)

    // No native confirm — an in-app dialog appears instead
    expect(confirmSpy).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/delete the saved view "doomed"/i)

    // Confirming triggers the API delete
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(mockDeleteListView).toHaveBeenCalledWith(5))
    confirmSpy.mockRestore()
  })

  it('surfaces an error when views fail to load', async () => {
    mockFetchListViews.mockRejectedValue(new Error('Boom'))
    renderControls()
    fireEvent.click(screen.getByRole('button', { name: /^views$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/i)
  })

  it('shows a loading state while views are being fetched', async () => {
    let resolve
    mockFetchListViews.mockReturnValue(new Promise((r) => { resolve = r }))
    renderControls()
    fireEvent.click(screen.getByRole('button', { name: /^views$/i }))
    expect(screen.getByText(/loading views/i)).toBeInTheDocument()
    resolve([])
    await waitFor(() => expect(screen.queryByText(/loading views/i)).not.toBeInTheDocument())
  })
})
