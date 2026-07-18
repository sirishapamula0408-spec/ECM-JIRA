import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-217 — Comment/activity feed sort-order toggle (newest/oldest)
   ================================================================ */

// Two comments with distinct timestamps: "Older comment" then "Newer comment"
const { mockState, OLDER, NEWER } = vi.hoisted(() => ({
  mockState: { issue: null },
  OLDER: { id: 11, author: 'Alice', text: 'Older comment', created_at: '2026-01-01T10:00:00Z', reactions: [] },
  NEWER: { id: 12, author: 'Alice', text: 'Newer comment', created_at: '2026-03-01T10:00:00Z', reactions: [] },
}))

// ---- API mocks (everything IssueDetailPage fetches on mount) ----
vi.mock('../api/issueApi', () => ({
  fetchIssueById: vi.fn().mockResolvedValue(null),
  fetchComments: vi.fn().mockResolvedValue([OLDER, NEWER]),
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

// ---- Context mocks (current user = "Test User") ----
vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: mockState.issue ? [mockState.issue] : [],
    handleMove: vi.fn(),
    handleUpdate: vi.fn().mockResolvedValue(undefined),
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

function renderPage(issue = baseIssue) {
  mockState.issue = issue
  return render(
    <MemoryRouter initialEntries={[`/issues/${issue.id}`]}>
      <Routes>
        <Route path="/issues/:issueId" element={<IssueDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

/** Returns rendered comment texts in document order. */
function renderedCommentTexts(container) {
  return Array.from(container.querySelectorAll('.id-comment-text')).map((el) => el.textContent.trim())
}

describe('IssueDetailPage — activity sort-order toggle (JL-217)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders comments newest-first by default with a toggle labelled accordingly', async () => {
    const { container } = renderPage()
    await screen.findByText('Newer comment')
    expect(renderedCommentTexts(container)).toEqual(['Newer comment', 'Older comment'])
    expect(screen.getByRole('button', { name: /sorted newest first/i })).toBeInTheDocument()
  })

  it('toggling the control reverses the order of the rendered comments', async () => {
    const { container } = renderPage()
    await screen.findByText('Newer comment')

    fireEvent.click(screen.getByRole('button', { name: /sorted newest first/i }))
    expect(renderedCommentTexts(container)).toEqual(['Older comment', 'Newer comment'])
    expect(screen.getByRole('button', { name: /sorted oldest first/i })).toBeInTheDocument()

    // Toggle back — newest-first again
    fireEvent.click(screen.getByRole('button', { name: /sorted oldest first/i }))
    expect(renderedCommentTexts(container)).toEqual(['Newer comment', 'Older comment'])
  })

  it('persists the chosen order to localStorage and restores it on a fresh render', async () => {
    const first = renderPage()
    await screen.findByText('Newer comment')
    fireEvent.click(screen.getByRole('button', { name: /sorted newest first/i }))
    expect(localStorage.getItem('activitySortOrder')).toBe('oldest')
    first.unmount()

    // Fresh mount picks up the persisted preference
    const { container } = renderPage()
    await screen.findByText('Newer comment')
    expect(renderedCommentTexts(container)).toEqual(['Older comment', 'Newer comment'])
    expect(screen.getByRole('button', { name: /sorted oldest first/i })).toBeInTheDocument()
  })
})
