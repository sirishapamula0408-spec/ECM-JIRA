import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

// Mock API modules
vi.mock('../api/dashboardApi', () => ({
  fetchActivity: vi.fn().mockResolvedValue({ activities: [], total: 0 }),
}))
vi.mock('../api/projectApi', () => ({
  fetchProjects: vi.fn().mockResolvedValue([]),
  fetchProjectById: vi.fn().mockResolvedValue({ name: 'Test Project' }),
}))
vi.mock('../api/memberApi', () => ({
  fetchMembers: vi.fn().mockResolvedValue([]),
  fetchProfile: vi.fn().mockResolvedValue(null),
}))
vi.mock('../api/sharedDashboardApi', () => ({
  fetchSharedDashboards: vi.fn().mockResolvedValue([]),
  createSharedDashboard: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
  deleteSharedDashboard: vi.fn().mockResolvedValue({ success: true }),
  cloneSharedDashboard: vi.fn().mockResolvedValue({ id: 2, name: 'Test (Copy)' }),
}))
vi.mock('../api/webhookApi', () => ({
  fetchWebhooks: vi.fn().mockResolvedValue([]),
  createWebhook: vi.fn().mockResolvedValue({ id: 1, name: 'Test Hook' }),
  deleteWebhook: vi.fn().mockResolvedValue({ success: true }),
  testWebhook: vi.fn().mockResolvedValue({ success: true, status: 200 }),
  fetchWebhookLogs: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/wikiApi', () => ({
  fetchWikiPages: vi.fn().mockResolvedValue([]),
  fetchWikiPage: vi.fn().mockResolvedValue({ id: 1, title: 'Test Page', content: 'Hello', children: [] }),
  createWikiPage: vi.fn().mockResolvedValue({ id: 1, title: 'New Page' }),
  deleteWikiPage: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('../api/notificationApi', () => ({
  fetchNotifications: vi.fn().mockResolvedValue({ notifications: [], unreadCount: 0 }),
  markNotificationRead: vi.fn().mockResolvedValue({ success: true }),
  markAllNotificationsRead: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('../context/MemberContext', () => ({
  useMembers: () => ({
    members: [{ id: 1, name: 'Test User', email: 'test@test.com' }],
    profile: { full_name: 'Test User' },
    currentMember: { workspaceRole: 'Admin', isOwner: false, projectRoles: [] },
  }),
  MemberProvider: ({ children }) => children,
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

import { ActivityFeedPage } from '../pages/ActivityFeedPage/ActivityFeedPage'
import { SharedDashboardsPage } from '../pages/SharedDashboardsPage/SharedDashboardsPage'
import { WebhooksPage } from '../pages/WebhooksPage/WebhooksPage'
import { MentionInput } from '../components/mentions/MentionInput'
import { NotificationProvider, useNotifications } from '../context/NotificationContext'
import { fetchActivity } from '../api/dashboardApi'
import { fetchSharedDashboards } from '../api/sharedDashboardApi'
import { fetchWebhooks } from '../api/webhookApi'

function renderWithRouter(component) {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

/* ================================================================
   ActivityFeedPage Tests
   ================================================================ */
describe('ActivityFeedPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the activity feed page with title', async () => {
    renderWithRouter(<ActivityFeedPage />)
    expect(screen.getByText('Activity Feed')).toBeInTheDocument()
  })

  it('shows empty state when no activities', async () => {
    renderWithRouter(<ActivityFeedPage />)
    await waitFor(() => {
      expect(screen.getByText('No activity found.')).toBeInTheDocument()
    })
  })

  it('renders filter dropdowns', () => {
    renderWithRouter(<ActivityFeedPage />)
    expect(screen.getByText('All types')).toBeInTheDocument()
    expect(screen.getByText('All projects')).toBeInTheDocument()
    expect(screen.getByText('All members')).toBeInTheDocument()
  })

  it('renders activity items when data is returned', async () => {
    fetchActivity.mockResolvedValueOnce({
      activities: [
        { id: 1, actor: 'John', action: 'created IT-1', happened_at: 'Just now', activity_type: 'issue', created_at: new Date().toISOString() },
      ],
      total: 1,
    })
    renderWithRouter(<ActivityFeedPage />)
    await waitFor(() => {
      expect(screen.getByText('John')).toBeInTheDocument()
      expect(screen.getByText('created IT-1')).toBeInTheDocument()
    })
  })
})

/* ================================================================
   SharedDashboardsPage Tests
   ================================================================ */
describe('SharedDashboardsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders page title', () => {
    renderWithRouter(<SharedDashboardsPage />)
    expect(screen.getByText('Shared Dashboards')).toBeInTheDocument()
  })

  it('shows create button', () => {
    renderWithRouter(<SharedDashboardsPage />)
    expect(screen.getByText('+ New Dashboard')).toBeInTheDocument()
  })

  it('shows empty state when no dashboards', async () => {
    renderWithRouter(<SharedDashboardsPage />)
    await waitFor(() => {
      expect(screen.getByText('No dashboards yet. Create one to get started.')).toBeInTheDocument()
    })
  })

  it('shows create form when button clicked', async () => {
    renderWithRouter(<SharedDashboardsPage />)
    fireEvent.click(screen.getByText('+ New Dashboard'))
    expect(screen.getByText('New Dashboard')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Dashboard name')).toBeInTheDocument()
  })

  it('renders dashboards from API', async () => {
    fetchSharedDashboards.mockResolvedValueOnce([
      { id: 1, name: 'Sprint Dashboard', description: 'For sprints', owner_email: 'test@test.com', visibility: 'private', updated_at: new Date().toISOString() },
    ])
    renderWithRouter(<SharedDashboardsPage />)
    await waitFor(() => {
      expect(screen.getByText('Sprint Dashboard')).toBeInTheDocument()
    })
  })
})

/* ================================================================
   WebhooksPage Tests
   ================================================================ */
describe('WebhooksPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders page title', () => {
    renderWithRouter(<WebhooksPage />)
    expect(screen.getByText('Webhook Integrations')).toBeInTheDocument()
  })

  it('shows create button for admin', () => {
    renderWithRouter(<WebhooksPage />)
    expect(screen.getByText('+ Create Webhook')).toBeInTheDocument()
  })

  it('shows empty state when no webhooks', async () => {
    renderWithRouter(<WebhooksPage />)
    await waitFor(() => {
      expect(screen.getByText('No webhooks configured.')).toBeInTheDocument()
    })
  })

  it('shows create form when button clicked', () => {
    renderWithRouter(<WebhooksPage />)
    fireEvent.click(screen.getByText('+ Create Webhook'))
    expect(screen.getByText('New Webhook')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Name')).toBeInTheDocument()
  })

  it('renders webhooks from API', async () => {
    fetchWebhooks.mockResolvedValueOnce([
      { id: 1, name: 'Slack Hook', url: 'https://hooks.slack.com', events: '["*"]', is_active: true, created_at: new Date().toISOString() },
    ])
    renderWithRouter(<WebhooksPage />)
    await waitFor(() => {
      expect(screen.getByText('Slack Hook')).toBeInTheDocument()
    })
  })
})

/* ================================================================
   MentionInput Tests
   ================================================================ */
describe('MentionInput', () => {
  it('renders textarea with placeholder', () => {
    renderWithRouter(<MentionInput value="" onChange={() => {}} placeholder="Type here..." />)
    expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument()
  })

  it('calls onChange when typing', () => {
    const onChange = vi.fn()
    renderWithRouter(<MentionInput value="" onChange={onChange} />)
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'hello', selectionStart: 5 } })
    expect(onChange).toHaveBeenCalledWith('hello')
  })
})

/* ================================================================
   NotificationContext Tests
   ================================================================ */
describe('NotificationContext', () => {
  it('provides default values', () => {
    function TestComponent() {
      const { notifications, unreadCount } = useNotifications()
      return (
        <div>
          <span data-testid="count">{unreadCount}</span>
          <span data-testid="length">{notifications.length}</span>
        </div>
      )
    }
    render(
      <NotificationProvider>
        <TestComponent />
      </NotificationProvider>
    )
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.getByTestId('length').textContent).toBe('0')
  })
})
