import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DashboardPage } from '../pages/DashboardPage/DashboardPage'

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children }) => children,
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

vi.mock('../context/IssueContext', () => ({
  useIssues: () => ({
    issues: [
      { id: 1, key: 'TP-1', title: 'Issue 1', status: 'To Do', priority: 'Medium', issueType: 'Task', assignee: 'Alice', projectId: 1 },
    ],
  }),
}))

vi.mock('../context/AppDataContext', () => ({
  useAppData: () => ({
    activity: [],
  }),
}))

vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([]),
}))

vi.mock('../hooks/useDashboardLayout', () => ({
  useDashboardLayout: () => ({
    title: 'My Dashboard',
    gadgets: [],
    setTitle: vi.fn(),
    addGadget: vi.fn(),
    removeGadget: vi.fn(),
    updateGadgetConfig: vi.fn(),
    updateGadgetSize: vi.fn(),
    updateGadgetTitle: vi.fn(),
    reorderGadgets: vi.fn(),
  }),
}))

vi.mock('../components/filters/FilterChip', () => ({
  FilterChip: ({ label }) => <span data-testid={`filter-${label}`}>{label}</span>,
}))

vi.mock('../components/dashboard/GadgetWrapper', () => ({
  GadgetWrapper: ({ children }) => <div>{children}</div>,
}))

vi.mock('../components/dashboard/AddGadgetModal', () => ({
  AddGadgetModal: () => <div data-testid="add-gadget-modal">Add Gadget Modal</div>,
}))

vi.mock('../components/dashboard/GadgetConfigModal', () => ({
  GadgetConfigModal: () => <div>Config Modal</div>,
}))

vi.mock('../components/dashboard/gadgets/PieChartGadget', () => ({
  PieChartGadget: () => <div>Pie</div>,
}))

vi.mock('../components/dashboard/gadgets/DonutChartGadget', () => ({
  DonutChartGadget: () => <div>Donut</div>,
}))

vi.mock('../components/dashboard/gadgets/BarChartGadget', () => ({
  BarChartGadget: () => <div>Bar</div>,
}))

vi.mock('../components/dashboard/gadgets/FilterResultsGadget', () => ({
  FilterResultsGadget: () => <div>Filter Results</div>,
}))

vi.mock('../components/dashboard/gadgets/ActivityStreamGadget', () => ({
  ActivityStreamGadget: () => <div>Activity</div>,
}))

vi.mock('../components/dashboard/gadgets/SprintHealthGadget', () => ({
  SprintHealthGadget: () => <div>Sprint Health</div>,
}))

import { usePermissions } from '../hooks/usePermissions'

function setupPermissions(overrides = {}) {
  usePermissions.mockReturnValue({
    loaded: true,
    workspaceRole: 'Member',
    projectRole: null,
    isOwner: false,
    isAdmin: false,
    canCreateIssue: true,
    canEditIssue: true,
    canDeleteIssue: false,
    canManageSprints: false,
    canManageProjectSettings: false,
    canManageMembers: false,
    canInviteMembers: false,
    canDeleteProject: false,
    canCreateProject: true,
    canEditWorkflows: false,
    canAddComment: true,
    ...overrides,
  })
}

describe('DashboardPage RBAC', () => {
  describe('when isAdmin=false', () => {
    beforeEach(() => {
      setupPermissions({ isAdmin: false })
    })

    it('should hide the Add Gadget button in the header', () => {
      render(<DashboardPage />)
      const headerActions = document.querySelector('.dashboard-actions')
      expect(headerActions).not.toBeInTheDocument()
    })

    it('should render the dashboard title as non-editable (no edit icon)', () => {
      render(<DashboardPage />)
      expect(screen.getByText('My Dashboard')).toBeInTheDocument()
      const editIcon = document.querySelector('.dashboard-title-edit')
      expect(editIcon).not.toBeInTheDocument()
    })

    it('should not enter edit mode when title is clicked', () => {
      render(<DashboardPage />)
      const title = screen.getByText('My Dashboard')
      title.click()
      expect(screen.queryByDisplayValue('My Dashboard')).not.toBeInTheDocument()
    })
  })

  describe('when isAdmin=true', () => {
    beforeEach(() => {
      setupPermissions({ isAdmin: true })
    })

    it('should show the Add Gadget button in the header', () => {
      render(<DashboardPage />)
      const headerActions = document.querySelector('.dashboard-actions')
      expect(headerActions).toBeInTheDocument()
    })

    it('should render the dashboard title with the edit icon', () => {
      render(<DashboardPage />)
      const editIcon = document.querySelector('.dashboard-title-edit')
      expect(editIcon).toBeInTheDocument()
    })

    it('should allow clicking the title to enter edit mode', () => {
      render(<DashboardPage />)
      const titleEl = document.querySelector('.dashboard-title')
      fireEvent.click(titleEl)
      // After clicking, title input should appear
      const input = document.querySelector('.dashboard-title-input')
      expect(input).toBeInTheDocument()
      expect(input.value).toBe('My Dashboard')
    })
  })
})
