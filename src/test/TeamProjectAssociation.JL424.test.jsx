// JL-424 — team <-> project association, seen from both ends.
//
// The permission rule and the "team membership grants no project access"
// invariant are enforced and proved server-side
// (server/__tests__/team-projects-JL424.test.js). This file covers the two
// surfaces: the team profile's "Works on" list, and the project summary's Teams
// card with its add/remove.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import { TeamProfilePage } from '../pages/TeamProfilePage/TeamProfilePage'
import { ProjectSummaryPage } from '../pages/ProjectSummaryPage/ProjectSummaryPage'
import {
  fetchTeam, fetchTeamProjects, fetchProjectTeams, fetchTeams,
  addProjectTeam, removeProjectTeam,
} from '../api/teamApi'
import { fetchMembers } from '../api/memberApi'
import { fetchActivity } from '../api/dashboardApi'
import { fetchProjectById } from '../api/projectApi'

vi.mock('../api/teamApi', () => ({
  fetchTeam: vi.fn(),
  updateTeam: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  updateTeamMemberRole: vi.fn(),
  addTeamLink: vi.fn(),
  removeTeamLink: vi.fn(),
  uploadTeamAvatar: vi.fn(),
  fetchTeamProjects: vi.fn(),
  addTeamProject: vi.fn(),
  removeTeamProject: vi.fn(),
  fetchProjectTeams: vi.fn(),
  fetchTeams: vi.fn(),
  addProjectTeam: vi.fn(),
  removeProjectTeam: vi.fn(),
}))
vi.mock('../api/memberApi', () => ({ fetchMembers: vi.fn() }))
vi.mock('../api/dashboardApi', () => ({ fetchActivity: vi.fn() }))
vi.mock('../api/projectApi', () => ({ fetchProjectById: vi.fn() }))

let currentMember = null
vi.mock('../context/MemberContext', () => ({ useMembers: () => ({ currentMember }) }))

// ProjectSummaryPage reads issues and sprints from context; neither matters here.
vi.mock('../context/IssueContext', () => ({ useIssues: () => ({ issues: [] }) }))
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))

const PROJECT = { id: 100, name: 'Apollo', key: 'APO', type: 'Software', lead: 'Ada', avatar_color: '#0052cc' }

const TEAM = {
  id: 7, name: 'Platform', description: null, avatarUrl: null, membership: 'OPEN',
  memberCount: 1, members: [], links: [], viewerRole: null, canManage: false,
}

function renderTeam() {
  return render(
    <MemoryRouter initialEntries={['/teams/7']}>
      <Routes><Route path="/teams/:teamId" element={<TeamProfilePage />} /></Routes>
    </MemoryRouter>,
  )
}

function renderProject() {
  return render(
    <MemoryRouter initialEntries={['/projects/100']}>
      <Routes><Route path="/projects/:projectId" element={<ProjectSummaryPage />} /></Routes>
    </MemoryRouter>,
  )
}

/** The Teams card on the project summary. */
async function teamsCard() {
  const heading = await screen.findByRole('heading', { name: /^teams$/i })
  return heading.closest('.ps-card')
}

beforeEach(() => {
  vi.clearAllMocks()
  currentMember = { memberId: 2, workspaceRole: 'Member', isOwner: false, projectRoles: [] }
  fetchTeam.mockResolvedValue(TEAM)
  fetchMembers.mockResolvedValue([])
  fetchActivity.mockResolvedValue({ activities: [], total: 0, hasMore: false, nextCursor: null })
  fetchTeamProjects.mockResolvedValue([])
  fetchProjectById.mockResolvedValue(PROJECT)
  fetchProjectTeams.mockResolvedValue([])
  fetchTeams.mockResolvedValue([])
})

describe('JL-424 — the team profile lists the projects it works on', () => {
  it('renders each project as a link to the project', async () => {
    fetchTeamProjects.mockResolvedValue([{ id: 100, name: 'Apollo', key: 'APO' }])
    renderTeam()
    const link = await screen.findByRole('link', { name: /Apollo/ })
    expect(link).toHaveAttribute('href', '/projects/100')
    expect(within(link).getByText('APO')).toBeInTheDocument()
  })

  it('states the empty case rather than showing nothing', async () => {
    renderTeam()
    expect(await screen.findByText(/not associated with a project yet/i)).toBeInTheDocument()
  })

  it('offers no add/remove on the team side — association is changed from the project', async () => {
    fetchTeamProjects.mockResolvedValue([{ id: 100, name: 'Apollo', key: 'APO' }])
    renderTeam()
    const heading = await screen.findByRole('heading', { name: /works on/i })
    const section = heading.closest('section')
    expect(within(section).queryByRole('button')).toBeNull()
  })
})

describe('JL-424 — the project summary shows and edits its teams', () => {
  it("lists the project's teams, each linking to the team profile", async () => {
    fetchProjectTeams.mockResolvedValue([{ id: 7, name: 'Platform', memberCount: 3 }])
    renderProject()
    const card = await teamsCard()
    const link = within(card).getByRole('link', { name: 'Platform' })
    expect(link).toHaveAttribute('href', '/teams/7')
  })

  it('states the empty case', async () => {
    renderProject()
    const card = await teamsCard()
    expect(within(card).getByText(/no teams yet/i)).toBeInTheDocument()
  })

  it('is READ-ONLY for someone without project-settings rights (AC#4)', async () => {
    fetchProjectTeams.mockResolvedValue([{ id: 7, name: 'Platform', memberCount: 3 }])
    renderProject()
    const card = await teamsCard()
    expect(within(card).queryByRole('button', { name: /add team/i })).toBeNull()
    expect(within(card).queryByRole('button', { name: /remove/i })).toBeNull()
    expect(within(card).queryByLabelText(/add a team to this project/i)).toBeNull()
    // The list itself is still visible — read-only, not hidden.
    expect(within(card).getByRole('link', { name: 'Platform' })).toBeInTheDocument()
  })

  it('lets a workspace Admin associate a team', async () => {
    currentMember = { memberId: 2, workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
    fetchTeams.mockResolvedValue([{ id: 7, name: 'Platform' }, { id: 8, name: 'Growth' }])
    addProjectTeam.mockResolvedValue([])
    renderProject()
    const card = await teamsCard()
    fireEvent.mouseDown(within(card).getByLabelText(/add a team to this project/i))
    fireEvent.click(await screen.findByRole('option', { name: 'Growth' }))
    fireEvent.click(within(card).getByRole('button', { name: /add team/i }))
    await waitFor(() => expect(addProjectTeam).toHaveBeenCalledWith('100', 8))
  })

  it('lets a project Admin who is only a workspace Member associate a team', async () => {
    currentMember = {
      memberId: 2, workspaceRole: 'Member', isOwner: false,
      projectRoles: [{ projectId: 100, role: 'Admin' }],
    }
    fetchTeams.mockResolvedValue([{ id: 8, name: 'Growth' }])
    renderProject()
    const card = await teamsCard()
    expect(within(card).getByRole('button', { name: /add team/i })).toBeInTheDocument()
  })

  it('dissociates a team', async () => {
    currentMember = { memberId: 2, workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
    fetchProjectTeams.mockResolvedValue([{ id: 7, name: 'Platform', memberCount: 3 }])
    removeProjectTeam.mockResolvedValue([])
    renderProject()
    const card = await teamsCard()
    fireEvent.click(within(card).getByRole('button', { name: /remove Platform from this project/i }))
    await waitFor(() => expect(removeProjectTeam).toHaveBeenCalledWith('100', 7))
  })

  it('surfaces a server rejection rather than swallowing it', async () => {
    currentMember = { memberId: 2, workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
    fetchProjectTeams.mockResolvedValue([{ id: 7, name: 'Platform', memberCount: 3 }])
    removeProjectTeam.mockRejectedValue(new Error('Insufficient project permissions'))
    renderProject()
    const card = await teamsCard()
    fireEvent.click(within(card).getByRole('button', { name: /remove Platform from this project/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/insufficient project permissions/i)
  })

  it('does not offer a team that is already associated', async () => {
    currentMember = { memberId: 2, workspaceRole: 'Admin', isOwner: false, projectRoles: [] }
    fetchProjectTeams.mockResolvedValue([{ id: 7, name: 'Platform', memberCount: 3 }])
    fetchTeams.mockResolvedValue([{ id: 7, name: 'Platform' }, { id: 8, name: 'Growth' }])
    renderProject()
    const card = await teamsCard()
    fireEvent.mouseDown(within(card).getByLabelText(/add a team to this project/i))
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options).toContain('Growth')
    expect(options).not.toContain('Platform')
  })
})
