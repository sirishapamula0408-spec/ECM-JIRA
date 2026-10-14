import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-194 — a project Admin manages their own project's people.

   ProjectSettingsPage.rbac.test.jsx mocks usePermissions outright, so it
   could not see that the REAL hook never matched a project role: /api/auth/me
   returned projectRoles as `projectid` (PostgreSQL lower-cased the unquoted
   alias) while the hook reads `pr.projectId`. Here the real usePermissions
   runs against currentMember exactly as /api/auth/me now returns it.
   ================================================================ */

const { memberState } = vi.hoisted(() => ({ memberState: { currentMember: null } }))

// ---- API mocks (everything ProjectSettingsPage fetches on mount) ----
vi.mock('../api/projectApi', () => ({
  fetchProjectById: vi.fn().mockResolvedValue({
    id: 1,
    key: 'TP',
    name: 'Test Project',
    type: 'Scrum',
    lead: 'Alice',
    avatar_color: '#0052cc',
    archived_at: null,
  }),
  updateProject: vi.fn().mockResolvedValue({}),
  archiveProject: vi.fn().mockResolvedValue({}),
  unarchiveProject: vi.fn().mockResolvedValue({}),
  fetchProjectMembers: vi.fn().mockResolvedValue([]),
  addProjectMember: vi.fn().mockResolvedValue({}),
  removeProjectMember: vi.fn().mockResolvedValue({}),
  updateProjectMemberRole: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/issueConfigApi', () => ({
  fetchProjectPriorities: vi.fn().mockResolvedValue([]),
  createPriority: vi.fn().mockResolvedValue({}),
  deletePriority: vi.fn().mockResolvedValue({}),
  fetchProjectStatuses: vi.fn().mockResolvedValue([]),
  createStatus: vi.fn().mockResolvedValue({}),
  deleteStatus: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/schemesApi', () => ({
  fetchPermissionSchemes: vi.fn().mockResolvedValue([]),
  fetchPermissionScheme: vi.fn().mockResolvedValue(null),
  createPermissionScheme: vi.fn().mockResolvedValue({}),
  addPermissionGrant: vi.fn().mockResolvedValue({}),
  deletePermissionGrant: vi.fn().mockResolvedValue({}),
  assignPermissionScheme: vi.fn().mockResolvedValue({}),
  fetchEffectivePermissions: vi.fn().mockResolvedValue({ fallback: true, schemeId: null, schemeName: 'Default' }),
  PERMISSION_KEYS: ['edit_issue'],
  SCHEME_ROLES: ['Admin', 'Member', 'Viewer'],
}))
vi.mock('../api/componentApi', () => ({
  fetchProjectComponents: vi.fn().mockResolvedValue([]),
  createComponent: vi.fn().mockResolvedValue({}),
  updateComponent: vi.fn().mockResolvedValue({}),
  deleteComponent: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/screenSchemeApi', () => ({
  fetchResolvedScreen: vi.fn().mockResolvedValue({ fields: [], configured: false }),
  saveScreenScheme: vi.fn().mockResolvedValue({ fields: [] }),
}))
vi.mock('../api/customFieldApi', () => ({
  fetchProjectCustomFields: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/fieldConfigApi', () => ({
  fetchFieldConfig: vi.fn().mockResolvedValue([]),
  saveFieldConfig: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/securityLevelApi', () => ({
  fetchSecurityLevels: vi.fn().mockResolvedValue([]),
  createSecurityLevel: vi.fn().mockResolvedValue({}),
  deleteSecurityLevel: vi.fn().mockResolvedValue({}),
}))

// ---- Context mocks: the REAL usePermissions reads this currentMember ----
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    members: [
      { id: 1, name: 'Alice', email: 'alice@test.com' },
      { id: 2, name: 'Bob', email: 'bob@test.com' },
    ],
    currentMember: memberState.currentMember,
  }),
  MemberProvider: ({ children }) => children,
}))
vi.mock('../components/common/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), confirmDialog: null }),
}))

import { addProjectMember } from '../api/projectApi'
import { ProjectSettingsPage } from '../pages/ProjectSettingsPage/ProjectSettingsPage'

// The /api/auth/me payload for a workspace Member.
const meAs = (projectRoles) => ({
  id: 9, email: 'pa@test.com', memberId: 9, workspaceRole: 'Member', isOwner: false,
  profile: null, projectCreationPolicy: 'all_members', projectRoles,
})

function renderSettings(projectId) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/settings`]}>
      <Routes>
        <Route path="/projects/:projectId/settings" element={<ProjectSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const accessTab = () => screen.queryByRole('button', { name: /^access$/i })

describe('ProjectSettingsPage — project Admin (JL-194)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the Access section to the Admin of this project and adds a member', async () => {
    memberState.currentMember = meAs([{ projectId: 1, projectKey: 'TP', projectName: 'Test Project', role: 'Admin' }])
    renderSettings(1)
    await screen.findByDisplayValue('Test Project')

    fireEvent.click(accessTab())
    expect(await screen.findByRole('heading', { name: /add people/i })).toBeInTheDocument()

    const [memberSelect] = screen.getAllByRole('combobox').filter((el) => el.closest('.ps-add-member-row'))
    addProjectMember.mockResolvedValueOnce({ id: 2, name: 'Bob', email: 'bob@test.com', role: 'Member' })
    fireEvent.change(memberSelect, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(addProjectMember).toHaveBeenCalledWith('1', { memberId: 2, role: expect.any(String) }))
    // The new member appears in the project's people list.
    expect(await screen.findByText('bob@test.com')).toBeInTheDocument()
  })

  it('treats a project Lead the same way', async () => {
    memberState.currentMember = meAs([{ projectId: 1, projectKey: 'TP', projectName: 'Test Project', role: 'Lead' }])
    renderSettings(1)
    await screen.findByDisplayValue('Test Project')
    expect(accessTab()).toBeInTheDocument()
  })

  it('does not give the Admin of ANOTHER project the Access section here', async () => {
    memberState.currentMember = meAs([{ projectId: 2, projectKey: 'OT', projectName: 'Other', role: 'Admin' }])
    renderSettings(1)
    await screen.findByDisplayValue('Test Project')
    expect(accessTab()).not.toBeInTheDocument()
  })

  it('a plain project Member gets read-only settings', async () => {
    memberState.currentMember = meAs([{ projectId: 1, projectKey: 'TP', projectName: 'Test Project', role: 'Member' }])
    renderSettings(1)
    await screen.findByDisplayValue('Test Project')
    expect(accessTab()).not.toBeInTheDocument()
  })
})
