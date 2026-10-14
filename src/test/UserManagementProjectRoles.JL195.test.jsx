import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

/* ================================================================
   JL-195 — Users page "Projects & roles" column.

   A system admin can tell, per user, which projects they belong to and
   whether they are that project's Admin/Lead — without opening every
   project's Access tab. The workspace role column is relabelled "System
   role" so the two kinds of admin are not confused.
   ================================================================ */

vi.mock('../api/memberApi', () => ({
  fetchMembersPage: vi.fn(),
  fetchUserAuditLog: vi.fn(() => Promise.resolve([])),
  inviteMember: vi.fn(),
  resendMemberInvite: vi.fn(),
  updateProfile: vi.fn(),
}))

import { UserManagementPage } from '../pages/UserManagementPage/UserManagementPage'
import { MemberProvider } from '../context/MemberProvider'
import { fetchMembersPage } from '../api/memberApi'

const pr = (projectId, projectKey, projectName, role) => ({ projectId, projectKey, projectName, role })

const MEMBERS = [
  { id: 1, name: 'Sam Sysadmin', email: 'sam@example.com', role: 'Admin', status: 'Active', projectRoles: [] },
  { id: 2, name: 'Pat ProjectAdmin', email: 'pat@example.com', role: 'Member', status: 'Active',
    projectRoles: [pr(4, 'OICL', 'OICL', 'Admin'), pr(2, 'MOB', 'Mobile App', 'Viewer')] },
  { id: 3, name: 'Lee Lead', email: 'lee@example.com', role: 'Member', status: 'Active',
    projectRoles: [pr(8, 'SP', 'Sample Project', 'Lead')] },
  { id: 4, name: 'Nia Newjoiner', email: 'nia@example.com', role: 'Member', status: 'Active', projectRoles: [] },
]

function renderPage() {
  return render(
    <BrowserRouter>
      <MemberProvider>
        <UserManagementPage />
      </MemberProvider>
    </BrowserRouter>,
  )
}

const rowOf = (name) => screen.getByText(name).closest('tr')

describe('UserManagementPage — Projects & roles (JL-195)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMembersPage.mockResolvedValue({ items: MEMBERS.map((m) => ({ ...m })), total: MEMBERS.length, limit: 25, offset: 0 })
  })

  it('labels the columns "System role" and "Projects & roles"', async () => {
    renderPage()
    await screen.findByText('Sam Sysadmin')
    expect(screen.getByRole('columnheader', { name: 'System role' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Projects & roles' })).toBeInTheDocument()
  })

  it('shows one chip per project with the role in it', async () => {
    renderPage()
    await screen.findByText('Pat ProjectAdmin')
    const row = within(rowOf('Pat ProjectAdmin'))
    expect(row.getByText('OICL · Admin')).toBeInTheDocument()
    expect(row.getByText('MOB · Viewer')).toBeInTheDocument()
  })

  it('highlights project Admin and Lead chips, not Member/Viewer ones', async () => {
    renderPage()
    await screen.findByText('Pat ProjectAdmin')
    const chip = (text) => screen.getByText(text).closest('.MuiChip-root')
    expect(chip('OICL · Admin')).toHaveClass('MuiChip-filled')
    expect(chip('SP · Lead')).toHaveClass('MuiChip-filled')
    expect(chip('MOB · Viewer')).toHaveClass('MuiChip-outlined')
    expect(chip('OICL · Admin')).toHaveAttribute('title', 'OICL: Admin (can manage this project)')
  })

  it('marks a system admin as having every project, and a user in none as "No projects"', async () => {
    renderPage()
    await screen.findByText('Sam Sysadmin')
    expect(within(rowOf('Sam Sysadmin')).getByText('All projects (system admin)')).toBeInTheDocument()
    expect(within(rowOf('Nia Newjoiner')).getByText('No projects')).toBeInTheDocument()
    expect(within(rowOf('Pat ProjectAdmin')).queryByText('No projects')).not.toBeInTheDocument()
  })

  it('renders when the API sends no projectRoles (older server)', async () => {
    fetchMembersPage.mockResolvedValue({
      items: [{ id: 9, name: 'Old Row', email: 'old@example.com', role: 'Member', status: 'Active' }],
      total: 1, limit: 25, offset: 0,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Old Row')).toBeInTheDocument())
    expect(within(rowOf('Old Row')).getByText('No projects')).toBeInTheDocument()
  })
})
