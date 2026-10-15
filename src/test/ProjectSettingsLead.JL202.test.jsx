import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-202 — Project Settings shows the same lead as the Projects list.

   The Lead dropdown listed members BY NAME and its value was the stored
   lead name. A lead who is not a workspace member matched no option, so
   the browser showed the first member instead (Sirisha for ECM's Alex
   Rivera) and Save would have replaced the real lead. Options are now
   members by id, plus an option for a non-member lead.
   ================================================================ */

// ---- API mocks (everything ProjectSettingsPage fetches on mount) ----
vi.mock('../api/projectApi', () => ({
  fetchProjectById: vi.fn(),
  updateProject: vi.fn(),
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
      { id: 6, name: 'Sirisha', email: 'sirisha@example.com' },
      { id: 105, name: 'Smoke Test', email: 'smoke@example.com' },
    ],
    currentMember: { workspaceRole: 'Admin', isOwner: true, projectRoles: [] },
  }),
  MemberProvider: ({ children }) => children,
}))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ loaded: true, isAdmin: true, isOwner: true, canManageProjectSettings: true }),
}))
vi.mock('../components/common/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), confirmDialog: null }),
}))

import { fetchProjectById, updateProject, fetchProjectMembers } from '../api/projectApi'
import { ProjectSettingsPage } from '../pages/ProjectSettingsPage/ProjectSettingsPage'

const project = (extra) => ({
  id: 1, key: 'ECM', name: 'ECM Platform', type: 'Scrum', avatar_color: '#0052cc', archived_at: null, ...extra,
})

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/projects/1/settings']}>
      <Routes>
        <Route path="/projects/:projectId/settings" element={<ProjectSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const leadSelect = () => screen.getByText('Project Lead').querySelector('select')
const shownLead = () => { const s = leadSelect(); return s.options[s.selectedIndex].text }

describe('ProjectSettingsPage — Project Lead (JL-202)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateProject.mockImplementation(async (_id, payload) => project({ name: payload.name, type: payload.type, lead: 'Alex Rivera', lead_member_id: null }))
  })

  it('shows a lead who is not a member, instead of the first member', async () => {
    fetchProjectById.mockResolvedValue(project({ lead: 'Alex Rivera', lead_member_id: null }))
    renderSettings()
    await screen.findByDisplayValue('ECM Platform')
    expect(shownLead()).toBe('Alex Rivera (not a member)')
  })

  it('selects a member lead by id', async () => {
    fetchProjectById.mockResolvedValue(project({ lead: 'Smoke Test', lead_member_id: 105 }))
    renderSettings()
    await screen.findByDisplayValue('ECM Platform')
    expect(leadSelect().value).toBe('105')
    expect(shownLead()).toBe('Smoke Test')
  })

  it('saving other fields does not send a lead change', async () => {
    fetchProjectById.mockResolvedValue(project({ lead: 'Alex Rivera', lead_member_id: null }))
    renderSettings()
    const name = await screen.findByDisplayValue('ECM Platform')
    fireEvent.change(name, { target: { value: 'ECM Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(updateProject).toHaveBeenCalled())
    const payload = updateProject.mock.calls[0][1]
    expect(payload).toEqual({ name: 'ECM Renamed', type: 'Scrum' })
    expect(payload).not.toHaveProperty('lead')
    expect(payload).not.toHaveProperty('leadMemberId')
  })

  it('changing the lead sends the member id', async () => {
    fetchProjectById.mockResolvedValue(project({ lead: 'Alex Rivera', lead_member_id: null }))
    updateProject.mockResolvedValue(project({ lead: 'Smoke Test', lead_member_id: 105 }))
    renderSettings()
    await screen.findByDisplayValue('ECM Platform')
    fireEvent.change(leadSelect(), { target: { value: '105' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('1', { name: 'ECM Platform', type: 'Scrum', leadMemberId: 105 }))
    await waitFor(() => expect(shownLead()).toBe('Smoke Test'))
  })

  it('marks the lead member in the Access list by id, not by a stale name', async () => {
    fetchProjectById.mockResolvedValue(project({ lead: 'Smoke Test', lead_member_id: 105 }))
    fetchProjectMembers.mockResolvedValue([
      { id: 6, name: 'Sirisha', email: 'sirisha@example.com', role: 'Admin' },
      { id: 105, name: 'Smoke Test', email: 'smoke@example.com', role: 'Lead' },
    ])
    renderSettings()
    await screen.findByDisplayValue('ECM Platform')
    fireEvent.click(screen.getByRole('button', { name: /^access$/i }))
    const smokeRow = (await screen.findByText('smoke@example.com')).closest('tr')
    expect(within(smokeRow).getByText('Lead', { selector: '.ps-lead-badge' })).toBeInTheDocument()
    const sirishaRow = screen.getByText('sirisha@example.com').closest('tr')
    expect(within(sirishaRow).queryByText('Lead', { selector: '.ps-lead-badge' })).toBeNull()
  })
})
