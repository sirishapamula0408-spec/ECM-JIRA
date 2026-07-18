import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'

// ── Mock MemberContext — usePermissions derives capabilities from it ──
vi.mock('../context/MemberContext', () => ({
  useMembers: vi.fn(),
}))

// ── Sidebar deps ──
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn(() => Promise.resolve([])),
  // ProjectSettingsPage imports
  fetchProjectById: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  unarchiveProject: vi.fn(),
  fetchProjectMembers: vi.fn(),
  addProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
  updateProjectMemberRole: vi.fn(),
}))

// ── ProjectSettingsPage API deps ──
vi.mock('../api/issueConfigApi', () => ({
  fetchProjectPriorities: vi.fn(() => Promise.resolve([])),
  createPriority: vi.fn(),
  deletePriority: vi.fn(),
  fetchProjectStatuses: vi.fn(() => Promise.resolve([])),
  createStatus: vi.fn(),
  deleteStatus: vi.fn(),
}))
vi.mock('../api/schemesApi', () => ({
  fetchPermissionSchemes: vi.fn(() => Promise.resolve([])),
  fetchPermissionScheme: vi.fn(() => Promise.resolve(null)),
  createPermissionScheme: vi.fn(),
  addPermissionGrant: vi.fn(),
  deletePermissionGrant: vi.fn(),
  assignPermissionScheme: vi.fn(),
  fetchEffectivePermissions: vi.fn(() => Promise.resolve({ fallback: true })),
  PERMISSION_KEYS: [],
  SCHEME_ROLES: [],
}))
vi.mock('../api/componentApi', () => ({
  fetchProjectComponents: vi.fn(() => Promise.resolve([])),
  createComponent: vi.fn(),
  updateComponent: vi.fn(),
  deleteComponent: vi.fn(),
}))
vi.mock('../api/screenSchemeApi', () => ({
  fetchResolvedScreen: vi.fn(() => Promise.resolve({ fields: [], configured: false })),
  saveScreenScheme: vi.fn(),
}))
vi.mock('../api/customFieldApi', () => ({
  fetchProjectCustomFields: vi.fn(() => Promise.resolve([])),
}))
vi.mock('../api/fieldConfigApi', () => ({
  fetchFieldConfig: vi.fn(() => Promise.resolve([])),
  saveFieldConfig: vi.fn(),
}))
vi.mock('../api/securityLevelApi', () => ({
  fetchSecurityLevels: vi.fn(() => Promise.resolve([])),
  createSecurityLevel: vi.fn(),
  deleteSecurityLevel: vi.fn(),
}))

import { Sidebar } from '../components/layout/Sidebar'
import { RequireRole } from '../components/auth/RequireRole'
import { ProjectSettingsPage } from '../pages/ProjectSettingsPage/ProjectSettingsPage'
import { useMembers } from '../context/MemberContext'
import { fetchProjectById, fetchProjectMembers } from '../api/projectApi'

function setupMember(currentMember) {
  useMembers.mockReturnValue({ members: [], currentMember })
}

const OWNER = { workspaceRole: 'Admin', isOwner: true, projectRoles: [] }
const ADMIN = { workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
const MEMBER = { workspaceRole: 'Member', isOwner: false, projectRoles: [] }
const VIEWER = { workspaceRole: 'Viewer', isOwner: false, projectRoles: [] }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Sidebar "Teams" nav link gating (JL-227)', () => {
  function renderSidebar() {
    return render(
      <MemoryRouter>
        <Sidebar
          collapsed={false}
          onToggleSidebar={() => {}}
          onCreateProject={() => {}}
          projectRefreshKey={0}
          hasProjects
        />
      </MemoryRouter>,
    )
  }

  it('shows the Teams link for an Admin', () => {
    setupMember(ADMIN)
    renderSidebar()
    const link = screen.getByRole('link', { name: 'Teams' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/teams')
  })

  it('shows the Teams link for the Owner', () => {
    setupMember(OWNER)
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Teams' })).toBeInTheDocument()
  })

  it('hides the Teams link for a Member', () => {
    setupMember(MEMBER)
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'Teams' })).not.toBeInTheDocument()
    expect(screen.queryByText('Teams')).not.toBeInTheDocument()
  })

  it('hides the Teams link for a Viewer', () => {
    setupMember(VIEWER)
    renderSidebar()
    expect(screen.queryByRole('link', { name: 'Teams' })).not.toBeInTheDocument()
  })
})

describe('/teams route gating (JL-227)', () => {
  // Mirrors the App.jsx composition: RequireRole with a redirect fallback
  function StubTeamsPage() {
    return <h1>Teams Page</h1>
  }

  function renderTeamsRoute() {
    return render(
      <MemoryRouter initialEntries={['/teams']}>
        <Routes>
          <Route path="/" element={<h1>Dashboard Home</h1>} />
          <Route
            path="/teams"
            element={(
              <RequireRole permission="canManageMembers" fallback={<Navigate to="/" replace />}>
                <StubTeamsPage />
              </RequireRole>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('renders the Teams page for an Admin', () => {
    setupMember(ADMIN)
    renderTeamsRoute()
    expect(screen.getByText('Teams Page')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard Home')).not.toBeInTheDocument()
  })

  it('renders the Teams page for the Owner', () => {
    setupMember(OWNER)
    renderTeamsRoute()
    expect(screen.getByText('Teams Page')).toBeInTheDocument()
  })

  it('redirects a Member away from /teams', () => {
    setupMember(MEMBER)
    renderTeamsRoute()
    expect(screen.queryByText('Teams Page')).not.toBeInTheDocument()
    expect(screen.getByText('Dashboard Home')).toBeInTheDocument()
  })

  it('redirects a Viewer away from /teams', () => {
    setupMember(VIEWER)
    renderTeamsRoute()
    expect(screen.queryByText('Teams Page')).not.toBeInTheDocument()
    expect(screen.getByText('Dashboard Home')).toBeInTheDocument()
  })
})

describe('ProjectSettingsPage Access tab gating (JL-227)', () => {
  const PROJECT = { id: 1, name: 'Demo', key: 'DEMO', type: 'Scrum', lead: 'Alice', avatar_color: '#000' }

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/projects/1/settings']}>
        <Routes>
          <Route path="/projects/:projectId/settings" element={<ProjectSettingsPage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  async function waitForLoad() {
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument())
  }

  beforeEach(() => {
    fetchProjectById.mockResolvedValue({ ...PROJECT })
    fetchProjectMembers.mockResolvedValue([])
  })

  it('shows the Access tab for a workspace Admin', async () => {
    setupMember(ADMIN)
    renderPage()
    await waitForLoad()
    expect(screen.getByRole('button', { name: /Access/ })).toBeInTheDocument()
  })

  it('shows the Access tab for a project Lead (workspace Member)', async () => {
    setupMember({
      workspaceRole: 'Member',
      isOwner: false,
      projectRoles: [{ projectId: 1, projectKey: 'DEMO', role: 'Lead' }],
    })
    renderPage()
    await waitForLoad()
    expect(screen.getByRole('button', { name: /Access/ })).toBeInTheDocument()
  })

  it('hides the Access tab for a workspace Member with a project Member role', async () => {
    setupMember({
      workspaceRole: 'Member',
      isOwner: false,
      projectRoles: [{ projectId: 1, projectKey: 'DEMO', role: 'Member' }],
    })
    renderPage()
    await waitForLoad()
    expect(screen.queryByRole('button', { name: /Access/ })).not.toBeInTheDocument()
    // No access-management UI anywhere on the page.
    expect(screen.queryByText('Add People')).not.toBeInTheDocument()
    expect(screen.queryByText('Project Members')).not.toBeInTheDocument()
  })

  it('hides the Access tab for a Viewer', async () => {
    setupMember(VIEWER)
    renderPage()
    await waitForLoad()
    expect(screen.queryByRole('button', { name: /Access/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Add People')).not.toBeInTheDocument()
  })
})
