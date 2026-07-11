import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-162 — "Assign to me" one-click shortcut on IssueDetailPage
   ================================================================ */

const { mockHandleUpdate, mockState } = vi.hoisted(() => ({
  mockHandleUpdate: vi.fn().mockResolvedValue(undefined),
  mockState: { issue: null },
}))

// ---- API mocks (everything IssueDetailPage fetches on mount) ----
vi.mock('../api/issueApi', () => ({
  fetchIssueById: vi.fn().mockResolvedValue(null),
  fetchComments: vi.fn().mockResolvedValue([]),
  createComment: vi.fn().mockResolvedValue({}),
  fetchSubtasks: vi.fn().mockResolvedValue({ subtasks: [], progress: { total: 0, done: 0, percent: 0 } }),
  createSubtask: vi.fn().mockResolvedValue({}),
  getIssueHistory: vi.fn().mockResolvedValue([]),
  fetchEpicChildren: vi.fn().mockResolvedValue({ children: [], rollup: { total: 0, done: 0, percent: 0 } }),
  fetchIssues: vi.fn().mockResolvedValue([]),
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
vi.mock('../api/cicdApi', () => ({
  fetchCiBuilds: vi.fn().mockResolvedValue([]),
}))

// ---- Context mocks (current user = "Test User") ----
vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: mockState.issue ? [mockState.issue] : [],
    handleMove: vi.fn(),
    handleUpdate: mockHandleUpdate,
  }),
  IssueProvider: ({ children }) => children,
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    members: [
      { id: 1, name: 'Test User', email: 'test@test.com' },
      { id: 2, name: 'Alice', email: 'alice@test.com' },
    ],
    profile: { full_name: 'Test User' },
    currentMember: { workspaceRole: 'Admin', isOwner: false, projectRoles: [] },
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
  usePermissions: () => ({
    loaded: true, isAdmin: true, isOwner: false,
    canCreateIssue: true, canEditIssue: true, canDeleteIssue: true,
    canManageSprints: true, canManageProjectSettings: true,
    canManageMembers: true, canInviteMembers: true,
    canDeleteProject: true, canCreateProject: true,
    canEditWorkflows: true, canAddComment: true,
    workspaceRole: 'Admin',
  }),
}))

import { IssueDetailPage } from '../pages/IssueDetailPage/IssueDetailPage'

const baseIssue = {
  id: 1,
  key: 'TP-1',
  title: 'Fix the flux capacitor',
  description: 'It broke',
  status: 'To Do',
  priority: 'Medium',
  issueType: 'Task',
  assignee: 'Alice',
  projectId: 1,
}

function renderPage(issue) {
  mockState.issue = issue
  return render(
    <MemoryRouter initialEntries={[`/issues/${issue.id}`]}>
      <Routes>
        <Route path="/issues/:issueId" element={<IssueDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('IssueDetailPage — "Assign to me" shortcut (JL-162)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandleUpdate.mockResolvedValue(undefined)
  })

  it('shows the "Assign to me" shortcut when the issue is assigned to someone else', async () => {
    renderPage({ ...baseIssue, assignee: 'Alice' })
    expect(await screen.findByRole('button', { name: 'Assign to me' })).toBeInTheDocument()
  })

  it('clicking "Assign to me" updates the assignee to the current user', async () => {
    renderPage({ ...baseIssue, assignee: 'Alice' })
    const btn = await screen.findByRole('button', { name: 'Assign to me' })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(mockHandleUpdate).toHaveBeenCalledWith(1, { assignee: 'Test User' })
    })
  })

  it('works for unassigned issues too', async () => {
    renderPage({ ...baseIssue, assignee: null })
    fireEvent.click(await screen.findByRole('button', { name: 'Assign to me' }))
    await waitFor(() => {
      expect(mockHandleUpdate).toHaveBeenCalledWith(1, { assignee: 'Test User' })
    })
  })

  it('hides the shortcut when the issue is already assigned to the current user', async () => {
    renderPage({ ...baseIssue, assignee: 'Test User' })
    // Wait for the page to settle, then confirm the shortcut is absent
    expect(await screen.findByText('Fix the flux capacitor')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument()
  })
})
