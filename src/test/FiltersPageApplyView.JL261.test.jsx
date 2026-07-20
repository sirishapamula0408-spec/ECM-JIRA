import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/* ================================================================
   JL-261 — applying a saved list view with a stored filterJql
   restores the JQL, switches to JQL mode, and re-runs the search.
   ================================================================ */

vi.mock('../api/filterApi', () => ({
  fetchFilters: vi.fn(() => Promise.resolve([])),
  createFilter: vi.fn(),
  updateFilter: vi.fn(),
  deleteFilter: vi.fn(),
  toggleFilterFavorite: vi.fn(),
  searchIssues: vi.fn(() => Promise.resolve([])),
  searchByJql: vi.fn(() => Promise.resolve([])),
  aiSearch: vi.fn(() => Promise.resolve({ issues: [], interpreted: [] })),
}))

vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn(() => Promise.resolve([])),
}))

// ListViewControls fetches saved views on mount — control what it returns.
vi.mock('../api/listViewApi', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchListViews: vi.fn(() => Promise.resolve([])),
    createListView: vi.fn(),
    updateListView: vi.fn(),
    deleteListView: vi.fn(),
  }
})

import { FiltersPage } from '../pages/FiltersPage/FiltersPage'
import { searchByJql, searchIssues } from '../api/filterApi'
import { fetchListViews } from '../api/listViewApi'

beforeEach(() => {
  vi.clearAllMocks()
  searchIssues.mockResolvedValue([])
  searchByJql.mockResolvedValue([])
})

// Render the page, switch to the Search tab, and run a basic search so the
// results panel (which hosts ListViewControls) is on screen.
async function renderWithResults() {
  render(
    <MemoryRouter>
      <FiltersPage />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Search Issues' }))
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  // Results panel header renders ListViewControls once a search resolves.
  await screen.findByRole('button', { name: /Views/ })
}

describe('FiltersPage — apply saved view filterJql (JL-261)', () => {
  it('restores the saved JQL, switches to JQL mode, and re-runs the search', async () => {
    fetchListViews.mockResolvedValue([
      { id: 7, name: 'High priority', columns: ['key', 'summary'], filterJql: 'priority = High', isDefault: false },
    ])

    await renderWithResults()

    // Open the saved-views dropdown and apply the view.
    fireEvent.click(screen.getByRole('button', { name: /Views/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'High priority' }))

    // The saved JQL is executed via the same search path as the run button.
    await waitFor(() => {
      expect(searchByJql).toHaveBeenCalledWith('priority = High')
    })

    // Page switched to JQL mode and the editor holds the restored query.
    const jqlInput = await screen.findByLabelText('JQL Query')
    expect(jqlInput.value).toBe('priority = High')
  })

  it('does not run a JQL search or change the query when the view has no filterJql', async () => {
    fetchListViews.mockResolvedValue([
      { id: 8, name: 'Columns only', columns: ['key', 'status'], filterJql: null, isDefault: false },
    ])

    await renderWithResults()

    fireEvent.click(screen.getByRole('button', { name: /Views/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Columns only' }))

    // No JQL search triggered; page stays in basic mode (no JQL editor).
    await waitFor(() => {
      expect(fetchListViews).toHaveBeenCalled()
    })
    expect(searchByJql).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('JQL Query')).toBeNull()
  })
})
