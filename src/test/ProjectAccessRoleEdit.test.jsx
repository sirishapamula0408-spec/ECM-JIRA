import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// ── Mock every API module the page imports ──
vi.mock('../api/projectApi', () => ({
  fetchProjectById: vi.fn(),
  updateProject: vi.fn(),
  fetchProjectMembers: vi.fn(),
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
  useMembers: () => ({ members: [] }),
}))

import { ProjectSettingsPage } from '../pages/ProjectSettingsPage/ProjectSettingsPage'
import {
  fetchProjectById,
  fetchProjectMembers,
  updateProjectMemberRole,
} from '../api/projectApi'

const PROJECT = { id: 1, name: 'Demo', key: 'DEMO', type: 'Scrum', lead: 'Alice', avatar_color: '#000' }
const MEMBERS = [
  { id: 1, name: 'Alice', email: 'alice@x.com', project_role: 'Admin' },
  { id: 2, name: 'Bob', email: 'bob@x.com', project_role: 'Member' },
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

async function renderAccessTab() {
  renderPage()
  // Wait for the project to load, then open the Access tab.
  await waitFor(() => expect(screen.getByRole('button', { name: /Access/ })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /Access/ }))
  await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument())
}

function rowFor(name) {
  return screen.getByText(name).closest('tr')
}

describe('ProjectSettingsPage Access tab — role editing (JL-212)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchProjectById.mockResolvedValue({ ...PROJECT })
    fetchProjectMembers.mockResolvedValue(MEMBERS.map((m) => ({ ...m })))
  })

  it('changes a member role inline and calls updateProjectMemberRole', async () => {
    updateProjectMemberRole.mockResolvedValue({ id: 2, project_role: 'Admin' })
    await renderAccessTab()

    const select = within(rowFor('Bob')).getByLabelText('Role for Bob')
    fireEvent.change(select, { target: { value: 'Admin' } })

    await waitFor(() => {
      expect(updateProjectMemberRole).toHaveBeenCalledWith('1', 2, 'Admin')
    })
    // Row reflects the new role.
    await waitFor(() => {
      expect(within(rowFor('Bob')).getByLabelText('Role for Bob').value).toBe('Admin')
    })
  })

  it('surfaces a guard failure and leaves the role unchanged', async () => {
    const err = new Error('Cannot demote the last remaining project admin')
    updateProjectMemberRole.mockRejectedValue(err)
    await renderAccessTab()

    const select = within(rowFor('Bob')).getByLabelText('Role for Bob')
    fireEvent.change(select, { target: { value: 'Viewer' } })

    await waitFor(() => {
      expect(updateProjectMemberRole).toHaveBeenCalledWith('1', 2, 'Viewer')
    })
    await waitFor(() => {
      expect(screen.getByText('Cannot demote the last remaining project admin')).toBeInTheDocument()
    })
    // Role not updated in state.
    expect(within(rowFor('Bob')).getByLabelText('Role for Bob').value).toBe('Member')
  })
})
