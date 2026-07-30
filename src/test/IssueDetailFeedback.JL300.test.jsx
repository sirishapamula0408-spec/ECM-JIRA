import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-300 — Visual feedback + auto-scroll after adding a linked
   issue or creating a sub-task on IssueDetailPage:
   - the relevant panel is scrolled into view (smooth, nearest)
   - a success snackbar confirms the action
   - the newly added row gets a brief highlight class
   ================================================================ */

const { mockState, mockData } = vi.hoisted(() => ({
  mockState: { issue: null, perms: {} },
  // mutable backing store so re-fetches after create return the new rows
  mockData: { subtasks: [], links: [] },
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
  title: 'Issue with long description',
  description: 'Body',
  status: 'To Do',
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

describe('IssueDetailPage — feedback after link / subtask creation (JL-300)', () => {
  let scrollSpy

  beforeEach(() => {
    vi.clearAllMocks()
    mockData.subtasks = []
    mockData.links = []
    // jsdom does not implement scrollIntoView — install a spy on the prototype
    scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy
  })

  it('creating a sub-task shows a success snackbar, scrolls the panel, and highlights the new row', async () => {
    renderPage()
    await screen.findByText('Issue with long description')

    fireEvent.click(screen.getByRole('button', { name: /\+ add sub-task/i }))
    fireEvent.change(screen.getByPlaceholderText('Sub-task summary'), { target: { value: 'Fresh subtask' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))

    // success snackbar
    expect(await screen.findByText('Sub-task created')).toBeInTheDocument()
    // panel scrolled into view
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' })
    // new row rendered with the brief highlight class
    const row = (await screen.findByText('Fresh subtask')).closest('li')
    expect(row).toHaveClass('id-row-flash')
  })

  it('linking an issue shows a success snackbar, scrolls the panel, and highlights the new row', async () => {
    renderPage()
    await screen.findByText('Issue with long description')

    fireEvent.click(screen.getByRole('button', { name: /\+ add link/i }))
    const dialog = document.querySelector('.id-link-dialog')
    expect(dialog).not.toBeNull()
    const selects = dialog.querySelectorAll('select')
    fireEvent.change(selects[1], { target: { value: '8' } }) // pick target issue TP-8
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }))

    // success snackbar
    expect(await screen.findByText('Issue link added')).toBeInTheDocument()
    // panel scrolled into view
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' })
    // new row rendered with the brief highlight class
    const row = (await screen.findByText('Other issue')).closest('li')
    expect(row).toHaveClass('id-row-flash')
  })

  it('does not show success feedback when link creation fails', async () => {
    const { createIssueLink } = await import('../api/issueLinkApi')
    createIssueLink.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    renderPage()
    await screen.findByText('Issue with long description')

    fireEvent.click(screen.getByRole('button', { name: /\+ add link/i }))
    const dialog = document.querySelector('.id-link-dialog')
    const selects = dialog.querySelectorAll('select')
    fireEvent.change(selects[1], { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }))

    await waitFor(() => expect(createIssueLink).toHaveBeenCalled())
    expect(screen.queryByText('Issue link added')).not.toBeInTheDocument()
    expect(scrollSpy).not.toHaveBeenCalled()
    // dialog stays open so the user can retry
    expect(document.querySelector('.id-link-dialog')).not.toBeNull()
  })
})
