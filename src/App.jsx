import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'

import { fetchIssues } from './api/issueApi'
import { fetchSprints } from './api/sprintApi'
import { fetchDashboard, fetchReports, fetchRoadmap, fetchWorkflows, fetchActivity } from './api/dashboardApi'
import { fetchMembers, fetchProfile } from './api/memberApi'

import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { IssueProvider, useIssues } from './context/IssueContext'
import { SprintProvider, useSprints } from './context/SprintContext'
import { AppDataProvider, useAppData } from './context/AppDataContext'
import { MemberProvider, useMembers } from './context/MemberContext'

import { ErrorBoundary } from './components/ErrorBoundary'
import { LoadingSkeleton } from './components/LoadingSkeleton'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { ProjectTopPanel } from './components/layout/ProjectTopPanel'
import { CreateIssueModal } from './components/issues/CreateIssueModal'
import { CreateProjectModal } from './components/projects/CreateProjectModal'

import { LoginPage } from './pages/LoginPage/LoginPage'
import { DashboardPage } from './pages/DashboardPage/DashboardPage'
import { BacklogPage } from './pages/BacklogPage/BacklogPage'
import { BoardPage } from './pages/BoardPage/BoardPage'
import { ReportsPage } from './pages/ReportsPage/ReportsPage'
import { RoadmapPage } from './pages/RoadmapPage/RoadmapPage'
import { WorkflowsPage } from './pages/WorkflowsPage/WorkflowsPage'
import { ProfilePage } from './pages/ProfilePage/ProfilePage'
import { IssueDetailPage } from './pages/IssueDetailPage/IssueDetailPage'
import { ActiveSprintPage } from './pages/ActiveSprintPage/ActiveSprintPage'
import { ProjectsPage } from './pages/ProjectsPage/ProjectsPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage/ProjectDetailPage'
import { ProjectSettingsPage } from './pages/ProjectSettingsPage/ProjectSettingsPage'
import { NotFoundPage } from './pages/NotFoundPage/NotFoundPage'
import { WorkflowEditorPage } from './pages/WorkflowEditorPage/WorkflowEditorPage'

import './styles/variables.css'
import './styles/theme.css'
import './styles/layout.css'
import './styles/shared.css'
import './pages/NotFoundPage/NotFoundPage.css'

function AppContent() {
  const { isAuthenticated } = useAuth()
  const { loadIssues } = useIssues()
  const { loadSprints } = useSprints()
  const { loadAppData, setAppLoading, setAppError, loading, error } = useAppData()
  const { loadProfile, loadMembers } = useMembers()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [projectRefreshKey, setProjectRefreshKey] = useState(0)

  useEffect(() => {
    if (!isAuthenticated) return
    setAppLoading(true)
    setAppError('')
    Promise.all([
      fetchDashboard(), fetchIssues(), fetchReports(), fetchRoadmap(),
      fetchWorkflows(), fetchSprints(), fetchProfile(), fetchMembers(), fetchActivity(),
    ])
      .then(([dashboardData, issuesData, , roadmapData, , sprintsData, profileData, membersData, activityData]) => {
        loadAppData({ dashboard: dashboardData, roadmap: roadmapData, activity: activityData })
        loadIssues(issuesData)
        loadSprints(sprintsData)
        loadProfile(profileData)
        loadMembers(membersData)
      })
      .catch((loadError) => setAppError(loadError.message))
      .finally(() => setAppLoading(false))
  }, [isAuthenticated, loadAppData, loadIssues, loadSprints, loadProfile, loadMembers, setAppLoading, setAppError])

  if (!isAuthenticated) return <LoginPage />

  return (
    <div className={`workspace${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={isSidebarCollapsed} onToggleSidebar={() => setIsSidebarCollapsed((c) => !c)} onCreateProject={() => setShowCreateProject(true)} projectRefreshKey={projectRefreshKey} />
      <main className="content" role="main">
        <Topbar onCreate={() => setShowCreate(true)} />
        <ProjectTopPanel onCreate={() => setShowCreate(true)} />
        {error && <p className="banner error" role="alert">{error}</p>}
        {loading && <LoadingSkeleton />}
        {!loading && (
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/backlog" element={<BacklogPage />} />
              <Route path="/board" element={<BoardPage />} />
              <Route path="/active-sprint" element={<ActiveSprintPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/roadmap" element={<RoadmapPage />} />
              <Route path="/projects" element={<ProjectsPage onCreateProject={() => setShowCreateProject(true)} projectRefreshKey={projectRefreshKey} onProjectDeleted={() => setProjectRefreshKey((k) => k + 1)} />} />
              <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
              <Route path="/projects/:projectId/settings" element={<ProjectSettingsPage />} />
              <Route path="/projects/:projectId/board" element={<BoardPage />} />
              <Route path="/projects/:projectId/backlog" element={<BacklogPage />} />
              <Route path="/projects/:projectId/reports" element={<ReportsPage />} />
              <Route path="/projects/:projectId/roadmap" element={<RoadmapPage />} />
              <Route path="/projects/:projectId/active-sprint" element={<ActiveSprintPage />} />
              <Route path="/projects/:projectId/list" element={<WorkflowsPage />} />
              <Route path="/workflows" element={<WorkflowsPage />} />
              <Route path="/workflow-editor" element={<WorkflowEditorPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/issues/:issueId" element={<IssueDetailPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </ErrorBoundary>
        )}
      </main>
      {showCreate && <CreateIssueModal onClose={() => setShowCreate(false)} />}
      {showCreateProject && <CreateProjectModal onClose={() => setShowCreateProject(false)} onProjectCreated={() => setProjectRefreshKey((k) => k + 1)} />}
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ThemeProvider>
          <IssueProvider>
            <SprintProvider>
              <AppDataProvider>
                <MemberProvider>
                  <AppContent />
                </MemberProvider>
              </AppDataProvider>
            </SprintProvider>
          </IssueProvider>
        </ThemeProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
