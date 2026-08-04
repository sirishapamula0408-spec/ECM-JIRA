import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from '../pages/DashboardPage/DashboardPage'

// JL-366: the Dashboard's Sprint filter chip built its options from
// `issue.sprint`, but API issues carry `sprintId` — the property was always
// undefined, so the dropdown never had options and the filter could not be
// applied. The fix resolves each issue's sprintId against the sprint records
// in SprintContext (names for display, ids for matching) and adds an explicit
// "No sprint" option for backlog issues.

// Mutable per-test fixtures returned by the mocked contexts.
let mockIssues = []
let mockSprints = []

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({ issues: mockIssues }),
}))
vi.mock('../context/AppDataContext', () => ({
  useAppData: () => ({ activity: [] }),
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({ profile: null, members: [] }),
}))
vi.mock('../context/SprintContext', () => ({
  useSprints: () => ({ sprints: mockSprints }),
}))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([{ id: 1, name: 'Apollo' }]),
}))

const STORAGE_KEY = 'jira_dashboard_layout'

// A Filter Results gadget renders the filtered issue list as visible rows,
// which lets the tests observe exactly which issues survive the Sprint filter.
function seedLayout() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    title: 'Dashboard',
    gadgets: [{ id: 'g1', type: 'filterResults', title: 'Results', size: 'large', config: {}, order: 0 }],
  }))
}

// Issues as the API really shapes them: `sprintId` (number | null), no
// `sprint` name field. AP-3 is a backlog item (sprintId: null).
const ISSUES = [
  { id: 1, key: 'AP-1', summary: 'Alpha sprint issue', projectId: 1, sprintId: 10, issueType: 'Story', priority: 'High', status: 'To Do', assignee: 'Dana' },
  { id: 2, key: 'AP-2', summary: 'Beta sprint issue', projectId: 1, sprintId: 11, issueType: 'Bug', priority: 'Low', status: 'Done', assignee: 'Evan' },
  { id: 3, key: 'AP-3', summary: 'Backlog only issue', projectId: 1, sprintId: null, issueType: 'Task', priority: 'Medium', status: 'Backlog', assignee: 'Dana' },
]

const SPRINTS = [
  { id: 10, name: 'Sprint Alpha', isStarted: false },
  { id: 11, name: 'Sprint Beta', isStarted: false },
]

async function renderDashboard() {
  const view = render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
  // Wait for the async fetchProjects effect to settle and the gadget to render.
  await screen.findByText(/of \d+ issues/)
  return view
}

function openSprintDropdown() {
  fireEvent.click(screen.getByRole('button', { name: /^Sprint:/ }))
  return screen.getByRole('listbox')
}

beforeEach(() => {
  localStorage.clear()
  seedLayout()
  mockIssues = ISSUES
  mockSprints = SPRINTS
})

describe('JL-366 — Sprint filter options come from sprintId + SprintContext', () => {
  it('lists the real sprint names for the sprints referenced by issues', async () => {
    await renderDashboard()

    const listbox = openSprintDropdown()
    const labels = within(listbox).getAllByRole('option').map((o) => o.textContent)

    expect(labels).toContain('Sprint Alpha')
    expect(labels).toContain('Sprint Beta')
    // The pre-fix code mapped issue.sprint (always undefined) — no options
    // beyond 'All' and certainly no 'undefined' entries.
    expect(labels).toContain('All')
    expect(labels).not.toContain('undefined')
  })

  it('offers a "No sprint" option because backlog issues exist', async () => {
    await renderDashboard()

    const listbox = openSprintDropdown()
    expect(within(listbox).getByRole('option', { name: 'No sprint' })).toBeInTheDocument()
  })

  it('omits the "No sprint" option when every issue is assigned to a sprint', async () => {
    mockIssues = ISSUES.filter((i) => i.sprintId !== null)
    await renderDashboard()

    const listbox = openSprintDropdown()
    expect(within(listbox).queryByRole('option', { name: 'No sprint' })).toBeNull()
  })
})

describe('JL-366 — selecting a sprint narrows the dashboard by sprintId', () => {
  it('shows only the selected sprint\'s issues', async () => {
    await renderDashboard()

    const listbox = openSprintDropdown()
    fireEvent.click(within(listbox).getByRole('option', { name: 'Sprint Alpha' }))

    expect(screen.getByText('Alpha sprint issue')).toBeInTheDocument()
    expect(screen.queryByText('Beta sprint issue')).toBeNull()
    expect(screen.queryByText('Backlog only issue')).toBeNull()
    // The chip reflects the applied filter by name.
    expect(screen.getByRole('button', { name: /Sprint: Sprint Alpha/ })).toBeInTheDocument()
  })

  it('"No sprint" isolates backlog issues (sprintId null)', async () => {
    await renderDashboard()

    const listbox = openSprintDropdown()
    fireEvent.click(within(listbox).getByRole('option', { name: 'No sprint' }))

    expect(screen.getByText('Backlog only issue')).toBeInTheDocument()
    expect(screen.queryByText('Alpha sprint issue')).toBeNull()
    expect(screen.queryByText('Beta sprint issue')).toBeNull()
  })

  it('clearing the sprint filter restores all issues', async () => {
    await renderDashboard()

    let listbox = openSprintDropdown()
    fireEvent.click(within(listbox).getByRole('option', { name: 'Sprint Beta' }))
    expect(screen.queryByText('Alpha sprint issue')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear Sprint filter' }))

    await waitFor(() => expect(screen.getByText('Alpha sprint issue')).toBeInTheDocument())
    expect(screen.getByText('Beta sprint issue')).toBeInTheDocument()
    expect(screen.getByText('Backlog only issue')).toBeInTheDocument()
  })
})

describe('JL-366 — no sprints available', () => {
  it('renders only "All" plus the search empty state, not a broken dropdown', async () => {
    mockSprints = []
    mockIssues = [] // nothing to derive sprint ids from either
    await renderDashboard()

    const listbox = openSprintDropdown()
    const options = within(listbox).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['All'])

    // Searching for a sprint surfaces the chip's built-in empty state.
    fireEvent.change(within(listbox).getByPlaceholderText('Search'), { target: { value: 'alpha' } })
    expect(within(listbox).getByText('No matches')).toBeInTheDocument()
  })

  it('labels an orphaned sprintId generically instead of dropping the issue', async () => {
    // Sprint records can lag or be deleted while issues still reference them.
    mockSprints = []
    mockIssues = [ISSUES[0]]
    await renderDashboard()

    const listbox = openSprintDropdown()
    fireEvent.click(within(listbox).getByRole('option', { name: 'Sprint 10' }))
    expect(screen.getByText('Alpha sprint issue')).toBeInTheDocument()
  })
})

describe('JL-366 — the other filter chips share the machinery and still work', () => {
  it('Status and Assignee filters keep narrowing independently of the sprint fix', async () => {
    await renderDashboard()

    // Status: Done → only AP-2 survives.
    fireEvent.click(screen.getByRole('button', { name: /^Status:/ }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Done' }))
    expect(screen.getByText('Beta sprint issue')).toBeInTheDocument()
    expect(screen.queryByText('Alpha sprint issue')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear Status filter' }))

    // Assignee options are still derived from issues, and filtering works.
    fireEvent.click(screen.getByRole('button', { name: /^Assignee:/ }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Dana' }))
    await waitFor(() => expect(screen.queryByText('Beta sprint issue')).toBeNull())
    expect(screen.getByText('Alpha sprint issue')).toBeInTheDocument()
    expect(screen.getByText('Backlog only issue')).toBeInTheDocument()
  })
})
