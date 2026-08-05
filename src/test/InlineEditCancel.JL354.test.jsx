import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-354 — the inline-edit Cancel (✕) button on IssueDetailPage's
   sidebar fields used to run the very same persisting handler as
   Confirm (✓), so there was no way to abandon an edit: the input's
   onChange had already written the draft into state and "cancelling"
   committed it (and wrote an issue-history entry).

   These tests cover a date field (Due date), a numeric field (Story
   points) and the Estimate field (whose draft is seeded from the
   worklog summary, not from the issue):
     - Cancel after editing  -> no API write, display unchanged
     - Reopening after Cancel -> shows the original value, not the draft
     - Confirm after editing -> API write happens
     - Open + Confirm with no edit -> no needless API write
   ================================================================ */

const { mockState } = vi.hoisted(() => ({
  mockState: { issue: null, perms: {}, handleUpdate: null },
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
  // Added at merge time — this suite was written on a branch cut before JL-360
  // landed, so it missed the mock JL-360 added to its five sibling suites.
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
    summary: { estimateText: '1d', spentText: null, remainingText: null, percent: null },
  }),
  logWork: vi.fn().mockResolvedValue({}),
  setEstimate: vi.fn().mockResolvedValue({
    estimateText: '2d', spentText: null, remainingText: null, percent: null,
  }),
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
    handleUpdate: mockState.handleUpdate,
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
import { setEstimate } from '../api/worklogApi'

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
  title: 'Cancel me',
  description: 'A description',
  status: 'To Do',
  priority: 'Medium',
  issueType: 'Task',
  assignee: 'Other Person',
  projectId: 3,
  // Note the full ISO timestamp: the date inputs are seeded with only the
  // YYYY-MM-DD slice, so a naive cancel reset would blank the field (JL-354).
  dueDate: '2026-01-15T00:00:00.000Z',
  startDate: '2026-01-02T00:00:00.000Z',
  storyPoints: 3,
}

async function renderPage() {
  mockState.issue = baseIssue
  mockState.perms = memberPerms
  mockState.handleUpdate = vi.fn().mockResolvedValue(undefined)
  const utils = render(
    <MemoryRouter initialEntries={[`/issues/${baseIssue.id}`]}>
      <Routes>
        <Route path="/issues/:issueId" element={<IssueDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
  await screen.findByText('Cancel me')
  // flush the mount fetches (worklog summary etc.)
  await act(async () => { await Promise.resolve() })
  return utils
}

/* Locate a sidebar detail row by its <dt> label. */
function fieldRow(container, label) {
  const row = [...container.querySelectorAll('.id-detail-row')]
    .find((r) => r.querySelector('dt')?.textContent === label)
  if (!row) throw new Error(`No sidebar row labelled "${label}"`)
  return row
}
const displayOf = (container, label) => fieldRow(container, label).querySelector('.id-inline-display')
const editorInput = (container, label) => fieldRow(container, label).querySelector('input')
const cancelBtn = (container, label) => fieldRow(container, label).querySelector('.id-inline-cancel')
const confirmBtn = (container, label) => fieldRow(container, label).querySelector('.id-inline-save')

function openField(container, label) {
  fireEvent.click(displayOf(container, label))
}

describe('JL-354 — inline-edit Cancel abandons the edit (Due date)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not persist and leaves the displayed value alone', async () => {
    const { container } = await renderPage()
    const before = displayOf(container, 'Due date').textContent

    openField(container, 'Due date')
    expect(editorInput(container, 'Due date')).toHaveValue('2026-01-15')

    fireEvent.change(editorInput(container, 'Due date'), { target: { value: '2026-03-20' } })
    await act(async () => { fireEvent.click(cancelBtn(container, 'Due date')) })

    expect(mockState.handleUpdate).not.toHaveBeenCalled()
    expect(displayOf(container, 'Due date').textContent).toBe(before)
  })

  it('shows the original value again when reopened after a Cancel', async () => {
    const { container } = await renderPage()

    openField(container, 'Due date')
    fireEvent.change(editorInput(container, 'Due date'), { target: { value: '2026-03-20' } })
    await act(async () => { fireEvent.click(cancelBtn(container, 'Due date')) })

    expect(editorInput(container, 'Due date')).toBeNull() // editor closed
    openField(container, 'Due date')
    expect(editorInput(container, 'Due date')).toHaveValue('2026-01-15')
  })

  it('still persists when Confirm is clicked', async () => {
    const { container } = await renderPage()

    openField(container, 'Due date')
    fireEvent.change(editorInput(container, 'Due date'), { target: { value: '2026-03-20' } })
    await act(async () => { fireEvent.click(confirmBtn(container, 'Due date')) })

    expect(mockState.handleUpdate).toHaveBeenCalledWith(7, { dueDate: '2026-03-20' })
  })

  it('does not write when opened and confirmed without an edit', async () => {
    const { container } = await renderPage()

    openField(container, 'Due date')
    await act(async () => { fireEvent.click(confirmBtn(container, 'Due date')) })

    expect(mockState.handleUpdate).not.toHaveBeenCalled()
  })
})

describe('JL-354 — inline-edit Cancel abandons the edit (Story points)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not persist and leaves the displayed value alone', async () => {
    const { container } = await renderPage()
    const before = displayOf(container, 'Story points').textContent

    openField(container, 'Story points')
    expect(editorInput(container, 'Story points')).toHaveValue(3)

    fireEvent.change(editorInput(container, 'Story points'), { target: { value: '13' } })
    await act(async () => { fireEvent.click(cancelBtn(container, 'Story points')) })

    expect(mockState.handleUpdate).not.toHaveBeenCalled()
    expect(displayOf(container, 'Story points').textContent).toBe(before)
  })

  it('shows the original value again when reopened after a Cancel', async () => {
    const { container } = await renderPage()

    openField(container, 'Story points')
    fireEvent.change(editorInput(container, 'Story points'), { target: { value: '13' } })
    await act(async () => { fireEvent.click(cancelBtn(container, 'Story points')) })

    expect(editorInput(container, 'Story points')).toBeNull() // editor closed
    openField(container, 'Story points')
    expect(editorInput(container, 'Story points')).toHaveValue(3)
  })

  it('still persists when Confirm is clicked', async () => {
    const { container } = await renderPage()

    openField(container, 'Story points')
    fireEvent.change(editorInput(container, 'Story points'), { target: { value: '13' } })
    await act(async () => { fireEvent.click(confirmBtn(container, 'Story points')) })

    expect(mockState.handleUpdate).toHaveBeenCalledWith(7, { storyPoints: 13 })
  })

  it('does not write when opened and confirmed without an edit', async () => {
    const { container } = await renderPage()

    openField(container, 'Story points')
    await act(async () => { fireEvent.click(confirmBtn(container, 'Story points')) })

    expect(mockState.handleUpdate).not.toHaveBeenCalled()
  })
})

describe('JL-354 — inline-edit Cancel abandons the edit (Estimate)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not call setEstimate and restores the seeded draft on reopen', async () => {
    const { container } = await renderPage()
    const before = displayOf(container, 'Estimate').textContent

    openField(container, 'Estimate')
    // Estimate is seeded from the worklog summary, not from the issue object.
    expect(editorInput(container, 'Estimate')).toHaveValue('1d')

    fireEvent.change(editorInput(container, 'Estimate'), { target: { value: '2d' } })
    await act(async () => { fireEvent.click(cancelBtn(container, 'Estimate')) })

    expect(setEstimate).not.toHaveBeenCalled()
    expect(displayOf(container, 'Estimate').textContent).toBe(before)

    openField(container, 'Estimate')
    expect(editorInput(container, 'Estimate')).toHaveValue('1d')
  })

  it('still persists when Confirm is clicked', async () => {
    const { container } = await renderPage()

    openField(container, 'Estimate')
    fireEvent.change(editorInput(container, 'Estimate'), { target: { value: '2d' } })
    await act(async () => { fireEvent.click(confirmBtn(container, 'Estimate')) })

    expect(setEstimate).toHaveBeenCalledWith(7, '2d')
  })

  it('does not write when opened and confirmed without an edit', async () => {
    const { container } = await renderPage()

    openField(container, 'Estimate')
    await act(async () => { fireEvent.click(confirmBtn(container, 'Estimate')) })

    expect(setEstimate).not.toHaveBeenCalled()
  })
})
