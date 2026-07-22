import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/* ================================================================
   JL-292 — ProjectsPage gates admin/create controls by permission.
   - Create-project buttons (header + empty-state) require canCreateProject.
   - Per-row "..." action menu (Archive/Restore/Move-to-trash) requires isAdmin.
   A Viewer must see none of these; a workspace Admin sees all of them.
   ================================================================ */

const { mockState } = vi.hoisted(() => ({
  mockState: { perms: {} },
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => mockState.perms,
}))

vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn(),
  deleteProject: vi.fn().mockResolvedValue({}),
  archiveProject: vi.fn().mockResolvedValue({}),
  unarchiveProject: vi.fn().mockResolvedValue({}),
}))

vi.mock('../api/favoriteApi', () => ({
  fetchFavorites: vi.fn().mockResolvedValue({ projectIds: [] }),
  favoriteProject: vi.fn().mockResolvedValue({}),
  unfavoriteProject: vi.fn().mockResolvedValue({}),
}))

import { fetchProjects } from '../api/projectApi'
import { ProjectsPage } from '../pages/ProjectsPage/ProjectsPage'

const projects = [
  { id: 1, name: 'Apollo', key: 'APO', type: 'Software', lead: 'Ada Lovelace', archived: false },
  { id: 2, name: 'Retired Rocket', key: 'RET', type: 'Software', lead: 'Grace Hopper', archived: true },
]

const viewerPerms = { loaded: true, isAdmin: false, canCreateProject: false }
const adminPerms = { loaded: true, isAdmin: true, canCreateProject: true }

function renderPage({ perms, onCreateProject = vi.fn() } = {}) {
  mockState.perms = perms
  return render(
    <MemoryRouter>
      <ProjectsPage onCreateProject={onCreateProject} projectRefreshKey={0} onProjectDeleted={vi.fn()} />
    </MemoryRouter>
  )
}

describe('ProjectsPage — RBAC gating (JL-292)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchProjects.mockResolvedValue(projects)
  })

  it('hides Create-project buttons and row action menus for a Viewer', async () => {
    renderPage({ perms: viewerPerms })
    await screen.findByText('Apollo')

    expect(screen.queryByRole('button', { name: /create project/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Create a project')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /project actions/i })).toHaveLength(0)
    expect(screen.queryByText('Archive project')).not.toBeInTheDocument()
    expect(screen.queryByText('Restore from archive')).not.toBeInTheDocument()
    expect(screen.queryByText('Move to trash')).not.toBeInTheDocument()

    // Read-only list still renders fully
    expect(screen.getByText('Apollo')).toBeInTheDocument()
    expect(screen.getByText('Retired Rocket')).toBeInTheDocument()
  })

  it('shows the Create button and row action menus for a workspace Admin', async () => {
    renderPage({ perms: adminPerms })
    await screen.findByText('Apollo')

    expect(screen.getByRole('button', { name: /create project/i })).toBeInTheDocument()

    const actionButtons = screen.getAllByRole('button', { name: /project actions/i })
    expect(actionButtons).toHaveLength(2)

    // Projects render newest-id-first, so index 0 is the archived project (id 2).
    fireEvent.click(actionButtons[0])
    expect(screen.getByText('Restore from archive')).toBeInTheDocument()

    // Index 1 is the active project (id 1) — confirm "Archive project" + "Move to trash" show
    fireEvent.click(actionButtons[1])
    expect(screen.getByText('Archive project')).toBeInTheDocument()
    expect(screen.getByText('Move to trash')).toBeInTheDocument()
  })

  it('shows the empty-state Create button only when canCreateProject is true', async () => {
    fetchProjects.mockResolvedValue([])

    const { unmount } = renderPage({ perms: viewerPerms })
    await screen.findByText("You're not assigned to any projects")
    expect(screen.queryByText('Create a project')).not.toBeInTheDocument()
    unmount()

    renderPage({ perms: adminPerms })
    await screen.findByText("You're not assigned to any projects")
    expect(screen.getByText('Create a project')).toBeInTheDocument()
  })
})
