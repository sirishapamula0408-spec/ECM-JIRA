import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Mock the API modules ProjectsPage imports ──
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn(),
  deleteProject: vi.fn(),
  archiveProject: vi.fn(),
  unarchiveProject: vi.fn(),
}))
vi.mock('../api/favoriteApi', () => ({
  fetchFavorites: vi.fn(() => Promise.resolve({ projectIds: [] })),
  favoriteProject: vi.fn(),
  unfavoriteProject: vi.fn(),
}))
vi.mock('../hooks/usePageTitle', () => ({ usePageTitle: () => {} }))

import { ProjectsPage } from '../pages/ProjectsPage/ProjectsPage'
import { fetchProjects, archiveProject } from '../api/projectApi'

const ACTIVE = { id: 1, name: 'Apollo', key: 'AP', type: 'Scrum', lead: 'Ada', avatar_color: '#0052cc', archived: false }
const ARCHIVED = { id: 2, name: 'Retired', key: 'RE', type: 'Scrum', lead: 'Bob', avatar_color: '#0052cc', archived: true }

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('JL-219 — ProjectsPage archive UX', () => {
  it('requests the active-only list by default (archived hidden)', async () => {
    fetchProjects.mockResolvedValue([ACTIVE])
    renderPage()

    await screen.findByText('Apollo')
    expect(fetchProjects).toHaveBeenCalledWith({ includeArchived: false })
    // the archived project is not present in the default list
    expect(screen.queryByText('Retired')).not.toBeInTheDocument()
  })

  it('re-fetches including archived when "Show archived" is toggled on', async () => {
    fetchProjects.mockResolvedValueOnce([ACTIVE])
    renderPage()
    await screen.findByText('Apollo')

    fetchProjects.mockResolvedValueOnce([ACTIVE, ARCHIVED])
    fireEvent.click(screen.getByLabelText('Show archived'))

    await waitFor(() =>
      expect(fetchProjects).toHaveBeenCalledWith({ includeArchived: true }),
    )
    await screen.findByText('Retired')
    // archived cards carry an "Archived" chip
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('archives a project via the action menu (calls the API)', async () => {
    fetchProjects.mockResolvedValue([ACTIVE])
    archiveProject.mockResolvedValue({ ...ACTIVE, archived: true, archived_at: '2026-07-18' })
    renderPage()
    await screen.findByText('Apollo')

    fireEvent.click(screen.getByLabelText('Project actions'))
    fireEvent.click(screen.getByText('Archive project'))
    // Themed ConfirmDialog (JL-232) replaces window.confirm — confirm via the dialog button.
    fireEvent.click(await screen.findByRole('button', { name: /^archive$/i }))

    await waitFor(() => expect(archiveProject).toHaveBeenCalledWith(1))
    // removed from the (active-only) list after archiving
    await waitFor(() => expect(screen.queryByText('Apollo')).not.toBeInTheDocument())
  })
})
