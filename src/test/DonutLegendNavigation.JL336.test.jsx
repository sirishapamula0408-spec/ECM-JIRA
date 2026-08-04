// JL-336 — clicking a legend entry in the dashboard's "Status Overview" gadget
// must open the issue list filtered to that status.
//
// The legend already owned a click handler (show/hide the slice), so the two
// behaviours are split across two affordances rather than fought over one:
//   • the colour DOT is a toggle button (the pre-existing behaviour), and
//   • the LABEL is a <Link> into the issue list.
// Both are asserted here — the toggle is a real feature and must survive.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { DonutChartGadget } from '../components/dashboard/gadgets/DonutChartGadget'
import { PieChartGadget } from '../components/dashboard/gadgets/PieChartGadget'
import { DashboardPage } from '../pages/DashboardPage/DashboardPage'

const STATUS_ISSUES = [
  { id: 1, status: 'To Do', assignee: 'Alice', priority: 'High', projectId: 42 },
  { id: 2, status: 'To Do', assignee: 'Alice', priority: 'Low', projectId: 42 },
  { id: 3, status: 'In Progress', assignee: 'Bob', priority: 'High', projectId: 42 },
  { id: 4, status: 'Done', assignee: 'Bob', priority: 'Medium', projectId: 42 },
]

// Only used by the DashboardPage wiring block at the bottom; the gadget-level
// tests above pass their props directly and are unaffected.
const fetchProjects = vi.fn()
vi.mock('../context/IssueContext', () => ({ useIssues: () => ({ issues: STATUS_ISSUES }) }))
vi.mock('../context/AppDataContext', () => ({ useAppData: () => ({ activity: [] }) }))
vi.mock('../context/MemberContext', () => ({ useMembers: () => ({ profile: null, members: [] }) }))
// JL-346: the dashboard resolves a sprint id for the burndown gadget.
vi.mock('../context/SprintContext', () => ({ useSprints: () => ({ sprints: [] }) }))
vi.mock('../api/projectApi', () => ({ fetchProjects: (...a) => fetchProjects(...a) }))

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname + loc.search}</div>
}

function renderGadget(ui) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      {ui}
      <LocationProbe />
    </MemoryRouter>,
  )
}

const currentPath = () => screen.getByTestId('loc').textContent
const dotFor = (label) => screen.getByRole('button', { name: new RegExp(`${label} slice`) })
const sliceCount = (container) => container.querySelectorAll('svg.pie-gadget-svg path').length

describe('JL-336 — donut legend navigates to the filtered issue list', () => {
  it('renders each status legend entry as a link to that project\'s list, filtered', () => {
    renderGadget(<DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status' }} projectId="7" />)

    expect(screen.getByRole('link', { name: 'To Do' })).toHaveAttribute(
      'href', '/projects/7/list?status=To%20Do',
    )
    expect(screen.getByRole('link', { name: 'In Progress' })).toHaveAttribute(
      'href', '/projects/7/list?status=In%20Progress',
    )
    expect(screen.getByRole('link', { name: 'Done' })).toHaveAttribute(
      'href', '/projects/7/list?status=Done',
    )
  })

  it('actually navigates to the scoped list when the label is clicked', () => {
    renderGadget(<DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status' }} projectId="7" />)

    fireEvent.click(screen.getByRole('link', { name: 'In Progress' }))

    expect(currentPath()).toBe('/projects/7/list?status=In%20Progress')
  })

  it('falls back to the unscoped /list when the dashboard project filter is "All"', () => {
    // DashboardPage passes projectId=null for 'All'; the unscoped route spans
    // every project, which is exactly what "All" means.
    renderGadget(<DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status' }} projectId={null} />)

    expect(screen.getByRole('link', { name: 'Done' })).toHaveAttribute('href', '/list?status=Done')

    fireEvent.click(screen.getByRole('link', { name: 'Done' }))
    expect(currentPath()).toBe('/list?status=Done')
  })

  it('is keyboard reachable — the navigating element is a real anchor with an href', () => {
    renderGadget(<DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status' }} projectId="7" />)

    const link = screen.getByRole('link', { name: 'To Do' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href')
    // Not removed from the tab order.
    expect(link.getAttribute('tabindex')).not.toBe('-1')
    link.focus()
    expect(document.activeElement).toBe(link)
  })

  it('keeps the show/hide-slice toggle working, on the colour dot', () => {
    const { container } = renderGadget(
      <DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status' }} projectId="7" />,
    )
    const before = sliceCount(container)
    expect(before).toBe(3)

    fireEvent.click(dotFor('To Do'))

    expect(sliceCount(container)).toBe(before - 1)
    expect(screen.getByRole('link', { name: 'To Do' }).closest('li')).toHaveClass('legend-hidden')

    // ...and toggling back restores the slice.
    fireEvent.click(dotFor('To Do'))
    expect(sliceCount(container)).toBe(before)
    expect(screen.getByRole('link', { name: 'To Do' }).closest('li')).not.toHaveClass('legend-hidden')
  })

  it('the toggle button is keyboard reachable and exposes its pressed state', () => {
    renderGadget(<DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status' }} projectId="7" />)

    const dot = dotFor('To Do')
    expect(dot.tagName).toBe('BUTTON')
    expect(dot).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(dot)
    expect(dotFor('To Do')).toHaveAttribute('aria-pressed', 'false')
  })

  it('navigating does not toggle the slice', () => {
    const { container } = renderGadget(
      <DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status' }} projectId="7" />,
    )
    const before = sliceCount(container)

    fireEvent.click(screen.getByRole('link', { name: 'To Do' }))

    expect(sliceCount(container)).toBe(before)
    expect(screen.getByRole('link', { name: 'To Do' }).closest('li')).not.toHaveClass('legend-hidden')
  })
})

describe('JL-336 — groupings the list cannot filter by do not pretend to link', () => {
  // IssueListPage only filters by status, so an assignee/priority link would
  // navigate to a list that silently ignored the filter. Those legends stay
  // toggle-only rather than promising something the destination can't honour.
  it('renders no links when grouping by assignee, but still toggles', () => {
    const { container } = renderGadget(
      <DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'assignee' }} projectId="7" />,
    )
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText('Alice')).toBeTruthy()

    const before = sliceCount(container)
    fireEvent.click(dotFor('Alice'))
    expect(sliceCount(container)).toBe(before - 1)
  })

  it('renders no links when grouping by priority', () => {
    renderGadget(<DonutChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'priority' }} projectId="7" />)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('does not link the "Unassigned" bucket that stands in for a missing status', () => {
    renderGadget(
      <DonutChartGadget issues={[{ id: 9 }, { id: 10, status: 'Done' }]} config={{ groupBy: 'status' }} projectId="7" />,
    )
    expect(screen.queryByRole('link', { name: 'Unassigned' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Done' })).toBeTruthy()
  })
})

describe('JL-336 — DashboardPage hands the legend its project scope', () => {
  // The gadget can only build the right link if the dashboard passes its
  // currently selected project down; that wiring is the bit that would break
  // silently, so assert it end-to-end.
  const STORAGE_KEY = 'jira_dashboard_layout'

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      title: 'Dashboard',
      gadgets: [{ id: 'g1', type: 'donut', title: 'Status Overview', size: 'small', config: { groupBy: 'status' }, order: 0 }],
    }))
    fetchProjects.mockReset()
  })

  it('links to the selected project\'s list', async () => {
    fetchProjects.mockResolvedValue([{ id: 42, name: 'Apollo' }])
    render(<MemoryRouter initialEntries={['/dashboard']}><DashboardPage /></MemoryRouter>)

    const link = await screen.findByRole('link', { name: 'Done' })
    expect(link).toHaveAttribute('href', '/projects/42/list?status=Done')
  })

  it('links to the unscoped list when no project is selected (project filter "All")', async () => {
    fetchProjects.mockResolvedValue([])
    render(<MemoryRouter initialEntries={['/dashboard']}><DashboardPage /></MemoryRouter>)

    const link = await screen.findByRole('link', { name: 'Done' })
    expect(link).toHaveAttribute('href', '/list?status=Done')
  })
})

describe('JL-336 — the pie gadget legend behaves identically', () => {
  it('links status labels and toggles from the dot', () => {
    const { container } = renderGadget(
      <PieChartGadget issues={STATUS_ISSUES} config={{ groupBy: 'status' }} projectId="7" />,
    )
    expect(screen.getByRole('link', { name: 'In Progress' })).toHaveAttribute(
      'href', '/projects/7/list?status=In%20Progress',
    )

    const before = sliceCount(container)
    fireEvent.click(dotFor('In Progress'))
    expect(sliceCount(container)).toBe(before - 1)
  })
})
