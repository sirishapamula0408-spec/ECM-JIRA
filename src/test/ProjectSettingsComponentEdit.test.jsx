import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// ── Mock every API module the page imports ──
vi.mock('../api/projectApi', () => ({
  fetchProjectById: vi.fn(),
  updateProject: vi.fn(),
  fetchProjectMembers: vi.fn(() => Promise.resolve([])),
  addProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
  updateProjectMemberRole: vi.fn(),
}))
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
vi.mock('../context/MemberContext', () => ({
  // JL-227: render as a workspace Admin so admin-gated tabs stay visible.
  useMembers: () => ({
    members: [],
    currentMember: { workspaceRole: 'Admin', isOwner: false, projectRoles: [] },
  }),
}))

import { ProjectSettingsPage } from '../pages/ProjectSettingsPage/ProjectSettingsPage'
import { fetchProjectById } from '../api/projectApi'
import { fetchProjectComponents, updateComponent } from '../api/componentApi'

const PROJECT = { id: 1, name: 'Demo', key: 'DEMO', type: 'Scrum', lead: 'Alice', avatar_color: '#000' }
const COMPONENTS = [
  { id: 1, projectId: 1, name: 'API', description: 'Backend', lead: 'alice', issueCount: 2 },
  { id: 2, projectId: 1, name: 'UI', description: '', lead: '', issueCount: 0 },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/settings']}>
      <Routes>
        <Route path="/projects/:projectId/settings" element={<ProjectSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function renderComponentsSection() {
  renderPage()
  // Wait for the project to load, then open the Statuses & Priorities tab (hosts Components).
  await waitFor(() => expect(screen.getByRole('button', { name: /Statuses/ })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /Statuses/ }))
  await waitFor(() => expect(screen.getByText('API')).toBeInTheDocument())
}

function rowFor(name) {
  return screen.getByText(name).closest('tr')
}

describe('ProjectSettingsPage Components — inline edit (JL-218)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchProjectById.mockResolvedValue({ ...PROJECT })
    fetchProjectComponents.mockResolvedValue(COMPONENTS.map((c) => ({ ...c })))
  })

  it('edits a component inline and calls updateComponent with the new values', async () => {
    updateComponent.mockResolvedValue({
      id: 1, projectId: 1, name: 'Platform API', description: 'Core backend', lead: 'bob', issueCount: 2,
    })
    await renderComponentsSection()

    fireEvent.click(within(rowFor('API')).getByRole('button', { name: 'Edit' }))

    fireEvent.change(screen.getByLabelText('Name for API'), { target: { value: 'Platform API' } })
    fireEvent.change(screen.getByLabelText('Description for API'), { target: { value: 'Core backend' } })
    fireEvent.change(screen.getByLabelText('Lead for API'), { target: { value: 'bob' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateComponent).toHaveBeenCalledWith('1', 1, {
        name: 'Platform API',
        description: 'Core backend',
        lead: 'bob',
      })
    })
    // Row reflects the updated component and leaves edit mode.
    await waitFor(() => expect(screen.getByText('Platform API')).toBeInTheDocument())
    expect(screen.queryByLabelText('Name for API')).not.toBeInTheDocument()
  })

  it('cancel leaves the component unchanged and does not call updateComponent', async () => {
    await renderComponentsSection()

    fireEvent.click(within(rowFor('API')).getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name for API'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(updateComponent).not.toHaveBeenCalled()
    expect(screen.getByText('API')).toBeInTheDocument()
  })

  it('surfaces a duplicate-name error from the API and stays in edit mode', async () => {
    updateComponent.mockRejectedValue(new Error('A component with that name already exists'))
    await renderComponentsSection()

    fireEvent.click(within(rowFor('API')).getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name for API'), { target: { value: 'UI' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('A component with that name already exists')).toBeInTheDocument()
    })
    // Still editing so the user can fix the name.
    expect(screen.getByLabelText('Name for API')).toBeInTheDocument()
  })
})
