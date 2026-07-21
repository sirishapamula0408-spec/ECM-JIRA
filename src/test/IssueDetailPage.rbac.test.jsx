import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-284 — IssueDetailPage read-only for a project Viewer.
   Every write control is gated by a usePermissions capability;
   a Member sees/uses all of them, a Viewer sees none.
   ================================================================ */

const { mockState } = vi.hoisted(() => ({
  mockState: { issue: null, perms: {} },
}))

// ---- API mocks (everything IssueDetailPage fetches on mount) ----
vi.mock('../api/issueApi', () => ({
  fetchIssueById: vi.fn().mockResolvedValue(null),
  fetchComments: vi.fn().mockResolvedValue([]),
  createComment: vi.fn().mockResolvedValue({}),
  updateComment: vi.fn().mockResolvedValue({}),
  deleteComment: vi.fn().mockResolvedValue({}),
  fetchSubtasks: vi.fn().mockResolvedValue({ subtasks: [], progress: { total: 0, done: 0, percent: 0 } }),
  createSubtask: vi.fn().mockResolvedValue({}),
  getIssueHistory: vi.fn().mockResolvedValue([]),
  fetchEpicChildren: vi.fn().mockResolvedValue({ children: [], rollup: { total: 0, done: 0, percent: 0 } }),
  fetchIssues: vi.fn().mockResolvedValue([]),
  addReaction: vi.fn().mockResolvedValue({ reactions: [] }),
  REACTION_EMOJIS: ['\u{1F44D}', '\u{1F389}'],
  cloneIssue: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/projectApi', () => ({
  fetchProjectById: vi.fn().mockResolvedValue({ name: 'Test Project' }),
}))
vi.mock('../api/watcherApi', () => ({
  fetchWatchers: vi.fn().mockResolvedValue({ isWatching: false, count: 0, watchers: [] }),
  watchIssue: vi.fn().mockResolvedValue({}),
  unwatchIssue: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/approvalApi', () => ({
  fetchIssueApprovals: vi.fn().mockResolvedValue([]),
  submitApproval: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/labelApi', () => ({
  fetchProjectLabels: vi.fn().mockResolvedValue([]),
  createLabel: vi.fn().mockResolvedValue({}),
  fetchIssueLabels: vi.fn().mockResolvedValue([]),
  setIssueLabels: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/componentApi', () => ({
  fetchProjectComponents: vi.fn().mockResolvedValue([]),
  fetchIssueComponents: vi.fn().mockResolvedValue([]),
  setIssueComponents: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/releaseApi', () => ({
  fetchProjectReleases: vi.fn().mockResolvedValue([]),
  fetchIssueVersions: vi.fn().mockResolvedValue({ fixVersions: [], affectsVersions: [] }),
  setIssueVersions: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/attachmentApi', () => ({
  fetchAttachments: vi.fn().mockResolvedValue([]),
  uploadAttachment: vi.fn().mockResolvedValue({}),
  deleteAttachment: vi.fn().mockResolvedValue({}),
  downloadAttachment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../api/issueLinkApi', () => ({
  fetchIssueLinks: vi.fn().mockResolvedValue([]),
  createIssueLink: vi.fn().mockResolvedValue({}),
  deleteIssueLink: vi.fn().mockResolvedValue({}),
  LINK_TYPES: ['blocks', 'is blocked by', 'duplicates', 'is duplicated by', 'relates to'],
}))
vi.mock('../api/gitIntegrationApi', () => ({
  fetchGitLinks: vi.fn().mockResolvedValue([]),
  createGitLink: vi.fn().mockResolvedValue({}),
  deleteGitLink: vi.fn().mockResolvedValue({}),
  fetchDeployments: vi.fn().mockResolvedValue([]),
  GIT_LINK_TYPES: ['branch', 'commit', 'pull_request'],
  GIT_LINK_TYPE_LABELS: { branch: 'Branch', commit: 'Commit', pull_request: 'Pull request' },
  PR_STATE_LABELS: { open: 'Open', merged: 'Merged', closed: 'Closed' },
}))
vi.mock('../api/worklogApi', () => ({
  fetchWorklogs: vi.fn().mockResolvedValue({
    worklogs: [],
    summary: { estimateText: null, spentText: null, remainingText: null, percent: null },
  }),
  logWork: vi.fn().mockResolvedValue({}),
  setEstimate: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/customFieldApi', () => ({
  fetchIssueCustomFields: vi.fn().mockResolvedValue([]),
  setIssueCustomField: vi.fn().mockResolvedValue({}),
  createCustomField: vi.fn().mockResolvedValue({}),
  deleteCustomField: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/securityLevelApi', () => ({
  fetchSecurityLevels: vi.fn().mockResolvedValue([]),
  setIssueSecurityLevel: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/cicdApi', () => ({
  fetchCiBuilds: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/assetApi', () => ({
  fetchAssets: vi.fn().mockResolvedValue([]),
  fetchIssueAssets: vi.fn().mockResolvedValue([]),
  linkIssueAsset: vi.fn().mockResolvedValue({}),
  unlinkIssueAsset: vi.fn().mockResolvedValue({}),
}))

// ---- Context mocks ----
vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: mockState.issue ? [mockState.issue] : [],
    handleMove: vi.fn(),
    handleUpdate: vi.fn().mockResolvedValue(undefined),
    handleDelete: vi.fn().mockResolvedValue(undefined),
  }),
  IssueProvider: ({ children }) => children,
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    members: [{ id: 1, name: 'Test User', email: 'test@test.com' }],
    profile: { full_name: 'Test User' },
    currentMember: { workspaceRole: 'Member', isOwner: false, projectRoles: [] },
  }),
  MemberProvider: ({ children }) => children,
}))
vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({ sprints: [] }),
  SprintProvider: ({ children }) => children,
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ authUser: { email: 'test@test.com' }, isAuthenticated: true }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => mockState.perms,
}))

import { IssueDetailPage } from '../pages/IssueDetailPage/IssueDetailPage'

const basePerms = {
  loaded: true, isAdmin: false, isOwner: false,
  canCreateIssue: true, canEditIssue: true, canDeleteIssue: true,
  canManageSprints: false, canManageProjectSettings: false,
  canManageMembers: false, canInviteMembers: false,
  canDeleteProject: false, canCreateProject: true,
  canEditWorkflows: false, canAddComment: true,
  canLogWork: true, canAddAttachment: true, canLinkIssues: true,
  workspaceRole: 'Member', projectRole: 'Member',
}

const memberPerms = { ...basePerms }
const viewerPerms = {
  ...basePerms,
  canCreateIssue: false, canEditIssue: false, canDeleteIssue: false,
  canCreateProject: false, canAddComment: false,
  canLogWork: false, canAddAttachment: false, canLinkIssues: false,
  workspaceRole: 'Viewer', projectRole: 'Viewer',
}

const baseIssue = {
  id: 7,
  key: 'TP-7',
  title: 'RBAC issue',
  description: 'A description',
  status: 'To Do',
  priority: 'Medium',
  issueType: 'Task',
  assignee: 'Other Person', // != currentUserName so "Assign to me" would show
  projectId: 3,
}

function renderPage({ perms }) {
  mockState.issue = baseIssue
  mockState.perms = perms
  return render(
    <MemoryRouter initialEntries={[`/issues/${baseIssue.id}`]}>
      <Routes>
        <Route path="/issues/:issueId" element={<IssueDetailPage />} />
        <Route path="/projects/:projectId" element={<div data-testid="project-page" />} />
      </Routes>
    </MemoryRouter>
  )
}

// Query helpers
const attachBtn = () => screen.queryByRole('button', { name: /^attach$/i })
const cloneBtn = () => screen.queryByRole('button', { name: /clone/i })
const createSubtaskBtn = () => screen.queryByRole('button', { name: /create subtask/i })
const addSubtaskBtn = () => screen.queryByRole('button', { name: /add sub-task/i })
const linkIssueBtn = () => screen.queryByRole('button', { name: /link issue/i })
const addLinkBtn = () => screen.queryByRole('button', { name: /\+ add link/i })
const assignToMeBtn = () => screen.queryByRole('button', { name: /assign to me/i })
const statusSelect = () => screen.queryByDisplayValue('To Do')
const commentComposer = () => screen.queryByPlaceholderText(/add a comment/i)
const logWorkBtn = () => screen.queryByRole('button', { name: /^log work$/i })

describe('IssueDetailPage — write controls for a project Member (JL-284)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows all write controls for a Member', async () => {
    renderPage({ perms: memberPerms })
    await screen.findByText('RBAC issue')

    expect(statusSelect()).toBeInTheDocument()
    expect(assignToMeBtn()).toBeInTheDocument()
    expect(attachBtn()).toBeInTheDocument()
    expect(createSubtaskBtn()).toBeInTheDocument()
    expect(addSubtaskBtn()).toBeInTheDocument()
    expect(linkIssueBtn()).toBeInTheDocument()
    expect(addLinkBtn()).toBeInTheDocument()
    expect(cloneBtn()).toBeInTheDocument()
    expect(commentComposer()).toBeInTheDocument()
  })

  it('shows the Log work control for a Member', async () => {
    renderPage({ perms: memberPerms })
    await screen.findByText('RBAC issue')
    fireEvent.click(screen.getByRole('button', { name: /work log/i }))
    expect(logWorkBtn()).toBeInTheDocument()
  })
})

describe('IssueDetailPage — read-only for a project Viewer (JL-284)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hides every write control for a Viewer', async () => {
    renderPage({ perms: viewerPerms })
    await screen.findByText('RBAC issue')

    // Status shown as a read-only badge, not an editable form control
    expect(statusSelect()).not.toBeInTheDocument()
    expect(screen.getByText('To Do')).toBeInTheDocument()

    expect(assignToMeBtn()).not.toBeInTheDocument()
    expect(attachBtn()).not.toBeInTheDocument()
    expect(createSubtaskBtn()).not.toBeInTheDocument()
    expect(addSubtaskBtn()).not.toBeInTheDocument()
    expect(linkIssueBtn()).not.toBeInTheDocument()
    expect(addLinkBtn()).not.toBeInTheDocument()
    expect(cloneBtn()).not.toBeInTheDocument()
    expect(commentComposer()).not.toBeInTheDocument()
  })

  it('hides the Log work control for a Viewer', async () => {
    renderPage({ perms: viewerPerms })
    await screen.findByText('RBAC issue')
    fireEvent.click(screen.getByRole('button', { name: /work log/i }))
    expect(logWorkBtn()).not.toBeInTheDocument()
  })

  it('still shows read-only values (title, description, status text)', async () => {
    renderPage({ perms: viewerPerms })
    await screen.findByText('RBAC issue')
    expect(screen.getByText('A description')).toBeInTheDocument()
    expect(screen.getByText('To Do')).toBeInTheDocument()
  })
})
