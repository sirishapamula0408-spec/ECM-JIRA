import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-293 — ProjectSettingsPage gates admin controls by capability.

   - Details editing (Name/Type/Lead inputs, Save/Discard, Archive/Restore)
     needs `canManageProjectSettings` — the backend PUT /:id and
     archive/unarchive routes require project Admin.
   - The Fields / Permissions / Screens / Field-config admin tabs are
     workspace-Admin-only server-side (requireRole('Admin')), so they are
     hidden unless `isAdmin`.
   A non-admin sees a read-only Details view; an admin sees everything.
   ================================================================ */

const { mockState } = vi.hoisted(() => ({
  mockState: { perms: {} },
}))

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

// ---- Context / hook mocks ----
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    members: [
      { id: 1, name: 'Alice', email: 'alice@test.com' },
      { id: 2, name: 'Bob', email: 'bob@test.com' },
    ],
    currentMember: { workspaceRole: 'Member', isOwner: false, projectRoles: [] },
  }),
  MemberProvider: ({ children }) => children,
}))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => mockState.perms,
}))
vi.mock('../components/common/ConfirmDialog', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), confirmDialog: null }),
}))

import { ProjectSettingsPage } from '../pages/ProjectSettingsPage/ProjectSettingsPage'

const basePerms = {
  loaded: true,
  isAdmin: false,
  isOwner: false,
  canManageProjectSettings: false,
}
const nonAdminPerms = { ...basePerms }
const adminPerms = { ...basePerms, isAdmin: true, isOwner: true, canManageProjectSettings: true }

function renderPage(perms) {
  mockState.perms = perms
  return render(
    <MemoryRouter initialEntries={['/projects/1/settings']}>
      <Routes>
        <Route path="/projects/:projectId/settings" element={<ProjectSettingsPage />} />
        <Route path="/projects/:projectId" element={<div data-testid="project-page" />} />
      </Routes>
    </MemoryRouter>,
  )
}

// Query helpers
const saveBtn = () => screen.queryByRole('button', { name: /^save$/i })
const discardBtn = () => screen.queryByRole('button', { name: /^discard$/i })
const archiveBtn = () => screen.queryByRole('button', { name: /archive project/i })
const fieldsTab = () => screen.queryByRole('button', { name: /statuses & priorities/i })
const permsTab = () => screen.queryByRole('button', { name: /^permissions$/i })
const screensTab = () => screen.queryByRole('button', { name: /^screens$/i })
const fieldConfigTab = () => screen.queryByRole('button', { name: /field configuration/i })

describe('ProjectSettingsPage — non-admin (JL-293)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders Details values read-only with no Save/Discard/Archive controls', async () => {
    renderPage(nonAdminPerms)
    const input = await screen.findByDisplayValue('Test Project')

    // Value still visible, but the input is disabled (read-only)
    expect(input).toBeInTheDocument()
    expect(input).toBeDisabled()

    expect(saveBtn()).not.toBeInTheDocument()
    expect(discardBtn()).not.toBeInTheDocument()
    expect(archiveBtn()).not.toBeInTheDocument()
  })

  it('hides the Fields/Permissions/Screens/Field-config admin tabs', async () => {
    renderPage(nonAdminPerms)
    await screen.findByDisplayValue('Test Project')

    expect(fieldsTab()).not.toBeInTheDocument()
    expect(permsTab()).not.toBeInTheDocument()
    expect(screensTab()).not.toBeInTheDocument()
    expect(fieldConfigTab()).not.toBeInTheDocument()
  })
})

describe('ProjectSettingsPage — admin (JL-293)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders editable Details with Save/Discard and the Archive panel', async () => {
    renderPage(adminPerms)
    const input = await screen.findByDisplayValue('Test Project')

    expect(input).toBeInTheDocument()
    expect(input).not.toBeDisabled()

    expect(saveBtn()).toBeInTheDocument()
    expect(discardBtn()).toBeInTheDocument()
    expect(archiveBtn()).toBeInTheDocument()
  })

  it('shows the Fields/Permissions/Screens/Field-config admin tabs', async () => {
    renderPage(adminPerms)
    await screen.findByDisplayValue('Test Project')

    expect(fieldsTab()).toBeInTheDocument()
    expect(permsTab()).toBeInTheDocument()
    expect(screensTab()).toBeInTheDocument()
    expect(fieldConfigTab()).toBeInTheDocument()
  })
})
