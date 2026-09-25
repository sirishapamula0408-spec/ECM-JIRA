import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/* ================================================================
   JL-149 — the issue breadcrumb: parent crumb, add-parent, and a
   current crumb that is a real link.

   Reported against 'Projects / Sample Project / SP-5':
     - SP-5 was inert text, not a navigation link
     - nothing offered to attach a parent, except for sub-tasks

   'Parent' is two different columns here, which is why the crumb only
   ever appeared for sub-tasks:
     Sub-task        -> parent_id  (its Story/Task/Bug)
     Story/Task/Bug  -> epic_id    (its Epic)
     Epic            -> neither, and may not be given one; the server
                        rejects 'An Epic cannot belong to another Epic'
   ================================================================ */

const { mockState, mockHandleDelete, mockHandleCreate, mockHandleUpdate } = vi.hoisted(() => ({
  mockState: { issue: null, perms: {} },
  mockHandleDelete: vi.fn().mockResolvedValue(undefined),
  mockHandleCreate: vi.fn(),
  mockHandleUpdate: vi.fn().mockResolvedValue(undefined),
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
    handleUpdate: mockHandleUpdate,
    handleDelete: mockHandleDelete,
    handleCreate: mockHandleCreate,
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
import { fetchIssues } from '../api/issueApi'

const basePerms = {
  loaded: true, isAdmin: false, isOwner: false,
  canCreateIssue: true, canEditIssue: true, canDeleteIssue: true,
  canManageSprints: false, canManageProjectSettings: false,
  canManageMembers: false, canInviteMembers: false,
  canDeleteProject: false, canCreateProject: true,
  canEditWorkflows: false, canAddComment: true,
  workspaceRole: 'Member', projectRole: 'Member',
}
const viewerPerms = { ...basePerms, canEditIssue: false, workspaceRole: 'Viewer', projectRole: 'Viewer' }

const TASK = {
  id: 5, key: 'SP-5', title: 'A task', description: '', status: 'To Do',
  priority: 'Medium', issueType: 'Task', assignee: 'Test User', projectId: 3,
}
const EPIC_ROW = { id: 90, key: 'SP-1', title: 'Platform work', issueType: 'Epic', projectId: 3 }

function renderPage({ issue = TASK, perms = basePerms, epics = [EPIC_ROW] } = {}) {
  mockState.issue = issue
  mockState.perms = perms
  // epicOptions is built from fetchIssues(), filtered to Epics in this project.
  fetchIssues.mockResolvedValue(epics)
  // Address the issue the way the app would: by key where it has one, by id
  // otherwise. Hardcoding the key produced /browse/undefined for the keyless
  // case, and the page never resolved an issue at all.
  return render(
    <MemoryRouter initialEntries={[`/browse/${issue.key ?? issue.id}`]}>
      <Routes>
        <Route path="/browse/:issueId" element={<IssueDetailPage />} />
        <Route path="/issues/:issueId" element={<IssueDetailPage />} />
        <Route path="/projects/:projectId" element={<div data-testid="project-page" />} />
      </Routes>
    </MemoryRouter>,
  )
}

const crumbs = () => document.querySelector('.id-breadcrumbs')
const currentCrumb = () => document.querySelector('.id-breadcrumb-current')
const addParent = () => screen.queryByRole('button', { name: /add parent/i })
const picker = () => document.querySelector('.id-parent-picker')

beforeEach(() => {
  vi.clearAllMocks()
  mockHandleUpdate.mockResolvedValue(undefined)
  mockHandleCreate.mockResolvedValue({ id: 500, key: 'SP-20', title: 'Brand new epic', issueType: 'Epic', projectId: 3 })
})

/* ---------------------------------------------------------------- */
describe('JL-149 — the current crumb is a navigation link', () => {
  it('renders the issue key as an anchor, not inert text', async () => {
    renderPage()
    await waitFor(() => expect(currentCrumb()).toBeTruthy())
    expect(currentCrumb().tagName).toBe('A')
    expect(currentCrumb().textContent).toBe('SP-5')
  })

  it('points at the canonical /browse/<key> URL', async () => {
    renderPage()
    await waitFor(() => expect(currentCrumb()).toBeTruthy())
    // A real href is what makes the key right-clickable, middle-clickable and
    // copyable — the whole reason for linking the current crumb at all.
    expect(currentCrumb().getAttribute('href')).toBe('/browse/SP-5')
  })

  it('falls back to the id for an issue with no key', async () => {
    renderPage({ issue: { ...TASK, key: undefined } })
    await waitFor(() => expect(currentCrumb()).toBeTruthy())
    expect(currentCrumb().getAttribute('href')).toBe('/browse/5')
  })
})

/* ---------------------------------------------------------------- */
describe('JL-149 — the parent crumb', () => {
  it('shows a Sub-task’s parent, resolved from parentKey', async () => {
    renderPage({
      issue: { ...TASK, issueType: 'Sub-task', parentId: 41, parentKey: 'SP-41' },
      epics: [],
    })
    await waitFor(() => expect(currentCrumb()).toBeTruthy())
    const parent = screen.getByRole('button', { name: 'SP-41' })
    expect(parent).toBeTruthy()
  })

  it('shows a Task’s Epic as its parent — previously only sub-tasks got a crumb', async () => {
    renderPage({ issue: { ...TASK, epicId: 90 } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'SP-1' })).toBeTruthy())
  })

  it('degrades to #id when the Epic is not in the loaded list, rather than hiding the relationship', async () => {
    renderPage({ issue: { ...TASK, epicId: 777 }, epics: [] })
    await waitFor(() => expect(currentCrumb()).toBeTruthy())
    expect(screen.getByRole('button', { name: '#777' })).toBeTruthy()
  })

  it('offers no add-parent affordance once a parent exists', async () => {
    renderPage({ issue: { ...TASK, epicId: 90 } })
    await waitFor(() => expect(currentCrumb()).toBeTruthy())
    expect(addParent()).toBeNull()
  })
})

/* ---------------------------------------------------------------- */
describe('JL-149 — "+ Add parent"', () => {
  it('is offered on a Task with no parent', async () => {
    renderPage()
    await waitFor(() => expect(addParent()).toBeTruthy())
  })

  it('is offered on a Story and a Bug too', async () => {
    for (const issueType of ['Story', 'Bug']) {
      const { unmount } = renderPage({ issue: { ...TASK, issueType } })
      await waitFor(() => expect(addParent(), issueType).toBeTruthy())
      unmount()
    }
  })

  it('is NOT offered on an Epic — an Epic cannot belong to another Epic', async () => {
    renderPage({ issue: { ...TASK, issueType: 'Epic' }, epics: [] })
    await waitFor(() => expect(currentCrumb()).toBeTruthy())
    expect(addParent()).toBeNull()
  })

  it('is NOT offered to someone who cannot edit the issue', async () => {
    renderPage({ perms: viewerPerms })
    await waitFor(() => expect(currentCrumb()).toBeTruthy())
    expect(addParent()).toBeNull()
  })

  it('stays clickable even when the project has no Epic — the picker explains why', async () => {
    // It used to be disabled here. A disabled control hides its reason behind a
    // tooltip nobody hovers; Atlassian opens the picker regardless and shows
    // the empty state inside it.
    renderPage({ epics: [] })
    await waitFor(() => expect(addParent()).toBeTruthy())
    expect(addParent()).not.toBeDisabled()

    fireEvent.click(addParent())
    expect(screen.getByText(/No Epics in this project yet/i)).toBeTruthy()
  })

  it('opens a searchable picker listing the project’s Epics', async () => {
    renderPage()
    await waitFor(() => expect(addParent()).toBeTruthy())
    fireEvent.click(addParent())

    expect(document.querySelector('.id-parent-picker')).toBeTruthy()
    expect(document.querySelector('.id-parent-picker-search')).toBeTruthy()
    // Scoped to the picker: the sidebar's Epic <select> also contributes
    // native <option> elements, so an unscoped role query matches those too.
    expect(within(picker()).getByRole('option', { name: /SP-1/ })).toBeTruthy()
  })

  it('filters the list as you type, and says so when nothing matches', async () => {
    renderPage()
    await waitFor(() => expect(addParent()).toBeTruthy())
    fireEvent.click(addParent())

    const search = document.querySelector('.id-parent-picker-search')
    fireEvent.change(search, { target: { value: 'platform' } })
    expect(within(picker()).getByRole('option', { name: /SP-1/ })).toBeTruthy()

    fireEvent.change(search, { target: { value: 'nothing-matches-this' } })
    expect(within(picker()).queryByRole('option')).toBeNull()
    expect(within(picker()).getByText(/No Epic matches/i)).toBeTruthy()
  })

  it('orders Epics most-recent-first, which is what a picker is used for', async () => {
    renderPage({
      epics: [
        { id: 1, key: 'SP-1', title: 'Older epic', issueType: 'Epic', projectId: 3, createdAt: '2026-01-01T00:00:00Z' },
        { id: 2, key: 'SP-9', title: 'Newer epic', issueType: 'Epic', projectId: 3, createdAt: '2026-09-01T00:00:00Z' },
      ],
    })
    await waitFor(() => expect(addParent()).toBeTruthy())
    fireEvent.click(addParent())

    const keys = [...document.querySelectorAll('.id-parent-picker-key')].map((n) => n.textContent)
    expect(keys).toEqual(['SP-9', 'SP-1'])
  })

  it('closes on Escape without setting anything', async () => {
    renderPage()
    await waitFor(() => expect(addParent()).toBeTruthy())
    fireEvent.click(addParent())
    fireEvent.keyDown(document.querySelector('.id-parent-picker'), { key: 'Escape' })
    expect(document.querySelector('.id-parent-picker')).toBeNull()
  })
})

/* ---------------------------------------------------------------- */
describe('JL-149 — the crumb trail as a whole', () => {
  it('reads Projects / Project / KEY when there is no parent', async () => {
    renderPage({ epics: [] })
    await waitFor(() => expect(currentCrumb()).toBeTruthy())
    const text = crumbs().textContent.replace(/\s+/g, ' ')
    expect(text).toContain('Projects')
    expect(text).toContain('Test Project')
    expect(text).toContain('SP-5')
  })

  it('keeps Projects and the project name as links', async () => {
    renderPage({ epics: [] })
    await waitFor(() => expect(currentCrumb()).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Projects' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Test Project' })).toBeTruthy()
  })
})

/* ---------------------------------------------------------------- */
describe('JL-149 — creating an Epic from the picker', () => {
  const createRow = () => screen.queryByRole('button', { name: /create epic/i })

  const openPickerWith = async (query, epics = []) => {
    renderPage({ epics })
    await waitFor(() => expect(addParent()).toBeTruthy())
    fireEvent.click(addParent())
    fireEvent.change(document.querySelector('.id-parent-picker-search'), { target: { value: query } })
  }

  it('offers to create one when the project has no Epics at all', async () => {
    await openPickerWith('Platform Foundation')
    expect(createRow()).toBeTruthy()
    expect(createRow().textContent).toContain('Platform Foundation')
  })

  it('prompts for a name before offering to create', async () => {
    // Nothing typed yet: there is no title to create the Epic with, so the row
    // would have nothing to name it.
    renderPage({ epics: [] })
    await waitFor(() => expect(addParent()).toBeTruthy())
    fireEvent.click(addParent())
    expect(createRow()).toBeNull()
    expect(within(picker()).getByText(/Type a name to create one/i)).toBeTruthy()
  })

  it('still offers to create alongside partial matches', async () => {
    // "Platform" matches an existing Epic, but that must not stop you making a
    // new one — the match may not be the one you meant.
    await openPickerWith('Platform', [EPIC_ROW])
    expect(within(picker()).getByRole('option', { name: /SP-1/ })).toBeTruthy()
    expect(createRow()).toBeTruthy()
  })

  it('creates the Epic with the typed name and the fields the API requires', async () => {
    await openPickerWith('Brand new epic')
    fireEvent.click(createRow())

    await waitFor(() => expect(mockHandleCreate).toHaveBeenCalledTimes(1))
    const payload = mockHandleCreate.mock.calls[0][0]
    expect(payload).toMatchObject({
      title: 'Brand new epic',
      issueType: 'Epic',
      projectId: 3,
    })
    // POST /api/issues validates these and defaults none of them, so the client
    // must send them rather than discover the requirement through a 400.
    expect(payload.description).toBeTruthy()
    expect(payload.assignee).toBeTruthy()
    expect(payload.priority).toBe('Medium')
    expect(payload.status).toBe('Backlog')
  })

  it('attaches this issue to the Epic it just created', async () => {
    await openPickerWith('Brand new epic')
    fireEvent.click(createRow())

    await waitFor(() => expect(mockHandleUpdate).toHaveBeenCalled())
    // The whole point: create AND assign, not create and leave the user to
    // link it themselves.
    expect(mockHandleUpdate).toHaveBeenCalledWith(5, { epicId: 500 })
  })

  it('closes the picker once the parent is set', async () => {
    await openPickerWith('Brand new epic')
    fireEvent.click(createRow())
    await waitFor(() => expect(picker()).toBeNull())
  })

  it('does not offer creation to someone who cannot create issues', async () => {
    mockState.perms = { ...basePerms, canCreateIssue: false }
    renderPage({ perms: { ...basePerms, canCreateIssue: false }, epics: [] })
    await waitFor(() => expect(addParent()).toBeTruthy())
    fireEvent.click(addParent())
    fireEvent.change(document.querySelector('.id-parent-picker-search'), { target: { value: 'Anything' } })
    expect(createRow()).toBeNull()
  })

  it('reports a failed creation instead of silently doing nothing', async () => {
    mockHandleCreate.mockRejectedValue(new Error('project is archived'))
    await openPickerWith('Doomed epic')
    fireEvent.click(createRow())

    await waitFor(() => expect(screen.getByText(/Could not create the Epic/i)).toBeTruthy())
    expect(screen.getByText(/project is archived/i)).toBeTruthy()
  })

  it('does not set a parent when creation failed', async () => {
    mockHandleCreate.mockRejectedValue(new Error('nope'))
    await openPickerWith('Doomed epic')
    fireEvent.click(createRow())

    await waitFor(() => expect(screen.getByText(/Could not create the Epic/i)).toBeTruthy())
    expect(mockHandleUpdate).not.toHaveBeenCalled()
  })
})
