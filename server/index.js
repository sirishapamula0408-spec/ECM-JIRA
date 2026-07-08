import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { initializeDatabase } from './db.js'
import { PORT } from './config.js'
import { errorHandler } from './middleware/errorHandler.js'
import { authGuard } from './middleware/authGuard.js'
import { loadUserRoles } from './middleware/authorize.js'
import authRoutes from './routes/auth.js'
import issueRoutes from './routes/issues.js'
import sprintRoutes from './routes/sprints.js'
import dashboardRoutes from './routes/dashboard.js'
import reportRoutes from './routes/reports.js'
import roadmapRoutes from './routes/roadmap.js'
import workflowRoutes from './routes/workflows.js'
import profileRoutes from './routes/profile.js'
import memberRoutes from './routes/members.js'
import invitationRoutes from './routes/invitations.js'
import activityRoutes from './routes/activity.js'
import projectRoutes from './routes/projects.js'
import commentRoutes from './routes/comments.js'
import filterRoutes from './routes/filters.js'
import notificationRoutes from './routes/notifications.js'
import watcherRoutes from './routes/watchers.js'
import approvalRoutes from './routes/approvals.js'
import sharedDashboardRoutes from './routes/shared-dashboards.js'
import webhookRoutes from './routes/webhooks.js'
import wikiRoutes from './routes/wiki.js'
import labelRoutes from './routes/labels.js'
import importExportRoutes from './routes/importExport.js'
import attachmentRoutes from './routes/attachments.js'
import issueLinkRoutes from './routes/issueLinks.js'
import worklogRoutes from './routes/worklogs.js'
import customFieldRoutes from './routes/customFields.js'
import automationRoutes from './routes/automation.js'
import releaseRoutes from './routes/releases.js'
import issueConfigRoutes from './routes/issueConfig.js'
import boardConfigRoutes from './routes/boardConfig.js'
import publicApiRoutes from './routes/publicApi.js'
import apiTokenRoutes from './routes/apiTokens.js'
import docsRoutes from './routes/docs.js'

const app = express()

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}))
app.use(express.json({ limit: '25mb' })) // 25mb accommodates base64 file uploads (Theme-1 #3 Attachments)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Public routes (no session auth required)
app.use('/api/auth', authRoutes)

// Public REST API (JL-84): authenticated by user-generated API tokens, not JWT sessions
app.use('/api/public', publicApiRoutes)

// API documentation (JL-58) — public, mounted before auth-protected routes
// GET /api/openapi.json (raw OpenAPI 3.0 spec) and GET /api/docs (HTML viewer)
app.use('/api', docsRoutes)

// Protected routes (JWT + role loading)
// authGuard verifies JWT and sets req.user = { id, email }
// loadUserRoles queries members table and adds workspaceRole, memberId, isOwner
const protect = [authGuard, loadUserRoles]

app.use('/api/issues', ...protect, issueRoutes)
app.use('/api/sprints', ...protect, sprintRoutes)
app.use('/api/dashboard', ...protect, dashboardRoutes)
app.use('/api/reports', ...protect, reportRoutes)
app.use('/api/roadmap', ...protect, roadmapRoutes)
app.use('/api/workflows', ...protect, workflowRoutes)
app.use('/api/profile', ...protect, profileRoutes)
app.use('/api/members', ...protect, memberRoutes)
app.use('/api/invitations', ...protect, invitationRoutes)
app.use('/api/activity', ...protect, activityRoutes)
app.use('/api/projects', ...protect, projectRoutes)
app.use('/api/issues', ...protect, commentRoutes)
app.use('/api/filters', ...protect, filterRoutes)
app.use('/api/notifications', ...protect, notificationRoutes)
app.use('/api/issues', ...protect, watcherRoutes)
app.use('/api/approvals', ...protect, approvalRoutes)
app.use('/api/shared-dashboards', ...protect, sharedDashboardRoutes)
app.use('/api/webhooks', ...protect, webhookRoutes)
app.use('/api/api-tokens', ...protect, apiTokenRoutes)
app.use('/api/wiki', ...protect, wikiRoutes)
app.use('/api', ...protect, labelRoutes)
app.use('/api', ...protect, importExportRoutes)
app.use('/api', ...protect, attachmentRoutes)
app.use('/api', ...protect, issueLinkRoutes)
app.use('/api', ...protect, worklogRoutes)
app.use('/api', ...protect, customFieldRoutes)
app.use('/api', ...protect, automationRoutes)
app.use('/api', ...protect, releaseRoutes)
app.use('/api', ...protect, issueConfigRoutes)
app.use('/api', ...protect, boardConfigRoutes)

app.use(errorHandler)

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API server running at http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('Database init failed:', err)
  })
