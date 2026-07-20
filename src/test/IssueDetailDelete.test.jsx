import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-228 — Issue-detail Delete control gated by canDeleteIssue
   (project Member+ can delete; Viewers see no delete UI)
   ================================================================ */

const { mockState, mockHandleDelete } = vi.hoisted(() => ({
  mockState: { issue: null, perms: {} },
  mockHandleDelete: vi.fn().mockResolvedValue(undefined),
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
    handleDelete: mockHandleDelete,
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
  workspaceRole: 'Member', projectRole: 'Member',
}

const memberPerms = { ...basePerms }
const viewerPerms = {
  ...basePerms,
  canCreateIssue: false, canEditIssue: false, canDeleteIssue: false,
  canCreateProject: false, canAddComment: false,
  workspaceRole: 'Viewer', projectRole: 'Viewer',
}

const baseIssue = {
  id: 7,
  key: 'TP-7',
  title: 'Deletable issue',
  description: 'To be removed',
  status: 'To Do',
  priority: 'Medium',
  issueType: 'Task',
  assignee: 'Test User',
  projectId: 3,
}

function renderPage({ issue = baseIssue, perms = memberPerms } = {}) {
  mockState.issue = issue
  mockState.perms = perms
  return render(
    <MemoryRouter initialEntries={[`/issues/${issue.id}`]}>
      <Routes>
        <Route path="/issues/:issueId" element={<IssueDetailPage />} />
        <Route path="/projects/:projectId" element={<div data-testid="project-page" />} />
      </Routes>
    </MemoryRouter>
  )
}

const deleteButton = () => screen.queryByRole('button', { name: /^delete issue$/i })

describe('IssueDetailPage — delete control gating (JL-228)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the Delete action for a project Member (canDeleteIssue true)', async () => {
    renderPage({ perms: memberPerms })
    await screen.findByText('Deletable issue')
    expect(deleteButton()).toBeInTheDocument()
  })

  it('hides the Delete action for a Viewer (canDeleteIssue false)', async () => {
    renderPage({ perms: viewerPerms })
    await screen.findByText('Deletable issue')
    expect(deleteButton()).not.toBeInTheDocument()
  })

  it('shows the Delete action for an Epic too (epics are issues)', async () => {
    renderPage({ issue: { ...baseIssue, issueType: 'Epic' }, perms: memberPerms })
    await screen.findByText('Deletable issue')
    expect(deleteButton()).toBeInTheDocument()
  })

  it('confirming delete calls IssueContext.handleDelete and navigates to the project', async () => {
    renderPage({ perms: memberPerms })
    await screen.findByText('Deletable issue')

    fireEvent.click(deleteButton())
    // Themed ConfirmDialog (JL-232) replaces window.confirm — confirm via the dialog button.
    const confirmBtn = await screen.findByRole('button', { name: /^delete$/i })
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(mockHandleDelete).toHaveBeenCalledWith(baseIssue.id))
    await screen.findByTestId('project-page')
  })

  it('cancelling the confirm dialog does not delete', async () => {
    renderPage({ perms: memberPerms })
    await screen.findByText('Deletable issue')

    fireEvent.click(deleteButton())
    const cancelBtn = await screen.findByRole('button', { name: /^cancel$/i })
    fireEvent.click(cancelBtn)
    expect(mockHandleDelete).not.toHaveBeenCalled()
  })
})
