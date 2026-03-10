import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { fetchIssues } from './api/issueApi'
import { fetchSprints } from './api/sprintApi'
import { fetchDashboard, fetchReports, fetchRoadmap, fetchWorkflows, fetchActivity } from './api/dashboardApi'
import { fetchMembers, fetchProfile } from './api/memberApi'
import { fetchProjects } from './api/projectApi'

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
import { TeamsPage } from './pages/TeamsPage/TeamsPage'
import { FiltersPage } from './pages/FiltersPage/FiltersPage'
import { ProjectSummaryPage } from './pages/ProjectSummaryPage/ProjectSummaryPage'

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
  const [hasProjects, setHasProjects] = useState(true)

  useEffect(() => {
    if (!isAuthenticated) return
    setAppLoading(true)
    setAppError('')
    Promise.all([
      fetchDashboard(), fetchIssues(), fetchReports(), fetchRoadmap(),
      fetchWorkflows(), fetchSprints(), fetchProfile(), fetchMembers(), fetchActivity(),
      fetchProjects(),
    ])
      .then(([dashboardData, issuesData, , roadmapData, , sprintsData, profileData, membersData, activityData, projectsData]) => {
        loadAppData({ dashboard: dashboardData, roadmap: roadmapData, activity: activityData })
        loadIssues(issuesData)
        loadSprints(sprintsData)
        loadProfile(profileData)
        loadMembers(membersData)
        setHasProjects(Array.isArray(projectsData) && projectsData.length > 0)
      })
      .catch((loadError) => setAppError(loadError.message))
      .finally(() => setAppLoading(false))
  }, [isAuthenticated, loadAppData, loadIssues, loadSprints, loadProfile, loadMembers, setAppLoading, setAppError])

  if (!isAuthenticated) return <LoginPage />

  return (
    <div className={`workspace${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={isSidebarCollapsed} onToggleSidebar={() => setIsSidebarCollapsed((c) => !c)} onCreateProject={() => setShowCreateProject(true)} projectRefreshKey={projectRefreshKey} hasProjects={hasProjects} />
      <main className="content" role="main">
        <Topbar onCreate={() => setShowCreate(true)} hasProjects={hasProjects} />
        <ProjectTopPanel onCreate={() => setShowCreate(true)} hasProjects={hasProjects} />
        {error && <p className="banner error" role="alert">{error}</p>}
        {loading && <LoadingSkeleton />}
        {!loading && (
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={hasProjects ? <DashboardPage /> : <Navigate to="/projects" replace />} />
              <Route path="/dashboard" element={hasProjects ? <DashboardPage /> : <Navigate to="/projects" replace />} />
              <Route path="/backlog" element={hasProjects ? <BacklogPage /> : <Navigate to="/projects" replace />} />
              <Route path="/board" element={hasProjects ? <BoardPage /> : <Navigate to="/projects" replace />} />
              <Route path="/active-sprint" element={hasProjects ? <ActiveSprintPage /> : <Navigate to="/projects" replace />} />
              <Route path="/reports" element={hasProjects ? <ReportsPage /> : <Navigate to="/projects" replace />} />
              <Route path="/roadmap" element={hasProjects ? <RoadmapPage /> : <Navigate to="/projects" replace />} />
              <Route path="/projects" element={<ProjectsPage onCreateProject={() => setShowCreateProject(true)} projectRefreshKey={projectRefreshKey} onProjectDeleted={() => setProjectRefreshKey((k) => k + 1)} />} />
              <Route path="/projects/:projectId" element={hasProjects ? <ProjectSummaryPage /> : <Navigate to="/projects" replace />} />
              <Route path="/projects/:projectId/settings" element={hasProjects ? <ProjectSettingsPage /> : <Navigate to="/projects" replace />} />
              <Route path="/projects/:projectId/board" element={hasProjects ? <BoardPage /> : <Navigate to="/projects" replace />} />
              <Route path="/projects/:projectId/backlog" element={hasProjects ? <BacklogPage /> : <Navigate to="/projects" replace />} />
              <Route path="/projects/:projectId/reports" element={hasProjects ? <ReportsPage /> : <Navigate to="/projects" replace />} />
              <Route path="/projects/:projectId/roadmap" element={hasProjects ? <RoadmapPage /> : <Navigate to="/projects" replace />} />
              <Route path="/projects/:projectId/active-sprint" element={hasProjects ? <ActiveSprintPage /> : <Navigate to="/projects" replace />} />
              <Route path="/projects/:projectId/list" element={hasProjects ? <WorkflowsPage /> : <Navigate to="/projects" replace />} />
              <Route path="/workflows" element={hasProjects ? <WorkflowsPage /> : <Navigate to="/projects" replace />} />
              <Route path="/workflow-editor" element={hasProjects ? <WorkflowEditorPage /> : <Navigate to="/projects" replace />} />
              <Route path="/filters" element={hasProjects ? <FiltersPage /> : <Navigate to="/projects" replace />} />
              <Route path="/teams" element={<TeamsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/issues/:issueId" element={hasProjects ? <IssueDetailPage /> : <Navigate to="/projects" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </ErrorBoundary>
        )}
      </main>
      {showCreate && <CreateIssueModal onClose={() => setShowCreate(false)} />}
      {showCreateProject && <CreateProjectModal onClose={() => setShowCreateProject(false)} onProjectCreated={() => { setProjectRefreshKey((k) => k + 1); setHasProjects(true) }} />}
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
