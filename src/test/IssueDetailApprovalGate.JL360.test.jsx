import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-360 — the approval gate is surfaced on IssueDetailPage:
   - a gated transition shows "Approval required — n of m <Role> approvals"
   - an ungated transition says so explicitly
   - a user without the approver role is told who can approve
   - a 409 refusal from the status select is explained, not swallowed
   ================================================================ */

const { mockState, mockData } = vi.hoisted(() => ({
  mockState: { issue: null, perms: {} },
  // mutable backing store: `gate` is what GET /approvals/check returns, and
  // `moveError` lets a test make the status change fail the way the server does.
  mockData: { subtasks: [], links: [], gate: { required: false }, moveError: null },
}))

// ---- API mocks (everything IssueDetailPage fetches on mount) ----
vi.mock('../api/issueApi', () => ({
  fetchIssueById: vi.fn().mockResolvedValue(null),
  fetchComments: vi.fn().mockResolvedValue([]),
  createComment: vi.fn().mockResolvedValue({}),
  updateComment: vi.fn().mockResolvedValue({}),
  deleteComment: vi.fn().mockResolvedValue({}),
  fetchSubtasks: vi.fn(() => Promise.resolve({
    subtasks: mockData.subtasks,
    progress: { total: mockData.subtasks.length, done: 0, percent: 0 },
  })),
  createSubtask: vi.fn(() => {
    mockData.subtasks = [{ id: 99, key: 'TP-99', title: 'Fresh subtask', status: 'To Do' }]
    return Promise.resolve({ id: 99, key: 'TP-99', title: 'Fresh subtask', status: 'To Do' })
  }),
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
  checkApproval: vi.fn(() => Promise.resolve(mockData.gate)),
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
  fetchIssueVersions: vi.fn().mockResolvedValue({ fix: [], affects: [] }),
  setIssueVersions: vi.fn().mockResolvedValue({}),
}))
vi.mock('../api/attachmentApi', () => ({
  fetchAttachments: vi.fn().mockResolvedValue([]),
  uploadAttachment: vi.fn().mockResolvedValue({}),
  deleteAttachment: vi.fn().mockResolvedValue({}),
  downloadAttachment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../api/issueLinkApi', () => ({
  fetchIssueLinks: vi.fn(() => Promise.resolve(mockData.links)),
  createIssueLink: vi.fn(() => {
    mockData.links = [{ id: 55, type: 'relates to', issue: { id: 8, key: 'TP-8', title: 'Other issue', status: 'To Do' } }]
    return Promise.resolve({ id: 55 })
  }),
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
    issues: mockState.issue
      ? [mockState.issue, { id: 8, key: 'TP-8', title: 'Other issue', status: 'To Do', priority: 'Medium', issueType: 'Task', projectId: 3 }]
      : [],
    handleMove: vi.fn(() => (mockData.moveError ? Promise.reject(mockData.moveError) : Promise.resolve({}))),
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

const memberPerms = {
  loaded: true, isAdmin: false, isOwner: false,
  canCreateIssue: true, canEditIssue: true, canDeleteIssue: true,
  canManageSprints: false, canManageProjectSettings: false,
  canManageMembers: false, canInviteMembers: false,
  canDeleteProject: false, canCreateProject: true,
  canEditWorkflows: false, canAddComment: true,
  canLogWork: true, canAddAttachment: true, canLinkIssues: true,
  workspaceRole: 'Member', projectRole: 'Member',
}

const baseIssue = {
  id: 7,
  key: 'TP-7',
  title: 'Gated issue',
  description: 'Body',
  status: 'In Progress',
  priority: 'Medium',
  issueType: 'Task',
  assignee: 'Test User',
  projectId: 3,
}

function renderPage() {
  mockState.issue = baseIssue
  mockState.perms = memberPerms
  return render(
    <MemoryRouter initialEntries={[`/issues/${baseIssue.id}`]}>
      <Routes>
        <Route path="/issues/:issueId" element={<IssueDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('IssueDetailPage — approval gate (JL-360)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockData.subtasks = []
    mockData.links = []
    mockData.gate = { required: false }
    mockData.moveError = null
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('shows the quorum progress when the transition is gated', async () => {
    mockData.gate = {
      required: true,
      approvedCount: 1,
      requiredApprovals: 2,
      approverRole: 'Lead',
      remaining: 1,
      satisfied: false,
      rejected: false,
      canApprove: true,
    }
    renderPage()
    await screen.findByText('Gated issue')

    const gate = await screen.findByTestId('approval-gate')
    expect(gate).toHaveTextContent('Approval required')
    expect(gate).toHaveTextContent('1 of 2 Lead approvals')
  })

  it('states plainly when no approval is required', async () => {
    renderPage()
    expect(await screen.findByText(/no approval required for this transition/i)).toBeInTheDocument()
    expect(screen.queryByTestId('approval-gate')).not.toBeInTheDocument()
  })

  it('hides the approve buttons for a user without the approver role', async () => {
    mockData.gate = {
      required: true, approvedCount: 0, requiredApprovals: 1, approverRole: 'Lead',
      remaining: 1, satisfied: false, rejected: false, canApprove: false,
    }
    renderPage()
    expect(await screen.findByText(/only a lead can approve this transition/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument()
  })

  it('explains a 409 refusal from the status select instead of swallowing it', async () => {
    const err = new Error('Transition from "In Progress" to "Done" requires 2 Lead approval(s) — 0 recorded')
    err.status = 409
    err.data = { approval: { required: true, approvedCount: 0, requiredApprovals: 2, approverRole: 'Lead', remaining: 2, rejected: false } }
    mockData.moveError = err

    renderPage()
    await screen.findByText('Gated issue')

    fireEvent.change(screen.getByDisplayValue('In Progress'), { target: { value: 'Done' } })

    await waitFor(() => {
      expect(screen.getByText(/requires 2 Lead approval/i)).toBeInTheDocument()
    })
  })

  it('marks a satisfied gate as approved', async () => {
    mockData.gate = {
      required: true, approvedCount: 2, requiredApprovals: 2, approverRole: 'Lead',
      remaining: 0, satisfied: true, rejected: false, canApprove: true,
    }
    renderPage()
    const gate = await screen.findByTestId('approval-gate')
    expect(gate).toHaveTextContent('Approved')
  })

  it('shows a standing rejection as blocking', async () => {
    mockData.gate = {
      required: true, approvedCount: 1, requiredApprovals: 1, approverRole: 'Lead',
      remaining: 0, satisfied: false, rejected: true, canApprove: true,
    }
    renderPage()
    const gate = await screen.findByTestId('approval-gate')
    expect(gate).toHaveTextContent(/blocked/i)
  })
})
