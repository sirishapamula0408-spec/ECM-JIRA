// JL-458 — the issue page no longer carries the four integration panels.
//
// Affected assets (JL-142), Development (JL-55), Deployments (JL-147) and
// CI/CD were four sections on the most-used page in the app, three of them
// permanently showing (0) because no provider is wired up to feed them.
//
// The harness below is lifted from IssueDetailDelete.test.jsx — IssueDetailPage
// fetches from twenty modules on mount, and every one still has to be mocked
// even though four of them are no longer imported. Those four mocks are kept
// deliberately: they are the ones that would have to come back first if the
// panels are ever restored, and a mock for an unimported module is a no-op.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

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
  // JL-360: the page now checks whether the next transition needs approval.
  checkApproval: vi.fn().mockResolvedValue({ required: false }),
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

describe("JL-458 — the four integration sections are gone", () => {
  it.each([
    ["Affected assets", /affected assets/i],
    ["Development", /^development$/i],
    ["Deployments", /^deployments/i],
    ["CI/CD", /^CI\/CD/i],
  ])("does not render the %s section", async (_label, pattern) => {
    renderPage();
    await screen.findByText("Deletable issue");
    expect(screen.queryByRole("heading", { name: pattern })).toBeNull();
  });

  it("does not render the Link asset control", async () => {
    renderPage();
    await screen.findByText("Deletable issue");
    expect(screen.queryByRole("button", { name: /link asset/i })).toBeNull();
  });
});

describe("JL-458 — everything else still renders", () => {
  // The removal must be surgical. If one of these disappears too, the JSX span
  // that was cut reached further than intended.
  // Description and Activity are unconditional; Attachments and Linked issues
  // render only under their own conditions, so they would prove nothing here.
  it.each([
    ["Description", /^description$/i],
    ["Activity", /^activity$/i],
  ])("still renders %s", async (_label, pattern) => {
    renderPage();
    await screen.findByText("Deletable issue");
    expect(screen.queryByRole("heading", { name: pattern }) ?? screen.queryByRole("button", { name: pattern })).toBeTruthy();
  });

  it("still renders the issue title and the delete control", async () => {
    renderPage();
    expect(await screen.findByText("Deletable issue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete issue$/i })).toBeInTheDocument();
  });
});

describe("JL-458 — the removal is unconditional, not permission-gated", () => {
  // The sections were never gated on a role, so a Viewer must not see them
  // either. This also guards the lazier possible "fix" — hiding the panels
  // behind a permission rather than removing them.
  it("shows none of the four sections to a Viewer", async () => {
    renderPage({ perms: viewerPerms });
    await screen.findByText("Deletable issue");
    for (const pattern of [/affected assets/i, /^development$/i, /^deployments/i, /^CI\/CD/i]) {
      expect(screen.queryByRole("heading", { name: pattern })).toBeNull();
    }
  });
});
