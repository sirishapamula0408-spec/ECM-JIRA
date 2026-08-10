import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

// Mock API modules (same approach as collaboration-pages.test.jsx)
vi.mock('../api/dashboardApi', () => ({
  fetchActivity: vi.fn().mockResolvedValue({ activities: [], total: 0 }),
}))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([{ id: 7, name: 'Apollo' }]),
  fetchProjectById: vi.fn().mockResolvedValue({ name: 'Apollo' }),
}))
vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn().mockResolvedValue([{ id: 3, name: 'Jane Doe', email: 'jane@test.com' }]),
  fetchProfile: vi.fn().mockResolvedValue(null),
}))

import { ActivityFeedPage } from '../pages/ActivityFeedPage/ActivityFeedPage'
import { fetchActivity } from '../api/dashboardApi'

function renderWithRouter(component) {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

async function selectMuiOption(comboboxName, optionName) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: comboboxName }))
  fireEvent.click(await screen.findByRole('option', { name: optionName }))
}

/* ================================================================
   JL-379 — Activity page MUI filter toolbar
   ================================================================ */
describe('ActivityFeedPage filters (JL-379)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders all five filter controls with accessible labels', async () => {
    renderWithRouter(<ActivityFeedPage />)
    expect(screen.getByRole('combobox', { name: /^Type/ })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /^Project/ })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /^Member/ })).toBeInTheDocument()
    expect(screen.getByLabelText('From')).toBeInTheDocument()
    expect(screen.getByLabelText('To')).toBeInTheDocument()
    // defaults show the "All ..." selections
    expect(screen.getByRole('combobox', { name: /^Type/ })).toHaveTextContent('All types')
    expect(screen.getByRole('combobox', { name: /^Project/ })).toHaveTextContent('All projects')
    expect(screen.getByRole('combobox', { name: /^Member/ })).toHaveTextContent('All members')
    await waitFor(() => expect(fetchActivity).toHaveBeenCalled())
  })

  it('changing the Type filter refetches with the type query param', async () => {
    renderWithRouter(<ActivityFeedPage />)
    await waitFor(() => expect(fetchActivity).toHaveBeenCalled())
    fetchActivity.mockClear()

    await selectMuiOption(/^Type/, 'Issues')

    await waitFor(() =>
      expect(fetchActivity).toHaveBeenCalledWith(expect.objectContaining({ type: 'issue' })),
    )
  })

  it('changing the From date refetches with the dateFrom query param', async () => {
    renderWithRouter(<ActivityFeedPage />)
    await waitFor(() => expect(fetchActivity).toHaveBeenCalled())
    fetchActivity.mockClear()

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-01' } })

    await waitFor(() =>
      expect(fetchActivity).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: '2026-08-01' })),
    )
  })

  it('Clear resets all filters and refetches without them', async () => {
    renderWithRouter(<ActivityFeedPage />)
    await waitFor(() => expect(fetchActivity).toHaveBeenCalled())

    await selectMuiOption(/^Type/, 'Issues')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-01' } })
    await waitFor(() =>
      expect(fetchActivity).toHaveBeenCalledWith(expect.objectContaining({ type: 'issue', dateFrom: '2026-08-01' })),
    )

    fetchActivity.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() =>
      expect(fetchActivity).toHaveBeenCalledWith(
        expect.objectContaining({ type: undefined, projectId: undefined, actor: undefined, dateFrom: undefined, dateTo: undefined }),
      ),
    )
    expect(screen.getByRole('combobox', { name: /^Type/ })).toHaveTextContent('All types')
    expect(screen.getByLabelText('From')).toHaveValue('')
  })
})
