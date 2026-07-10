import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { initializeDatabase } from './db.js'
import { PORT, assertRequiredEnv, assertValidConfig } from './config.js'
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
import workflowTransitionRoutes from './routes/workflowTransitions.js'
import releaseRoutes from './routes/releases.js'
import goalRoutes from './routes/goals.js'
import issueConfigRoutes from './routes/issueConfig.js'
import boardConfigRoutes from './routes/boardConfig.js'
import slaRoutes from './routes/sla.js'
import gitIntegrationRoutes from './routes/gitIntegration.js'
import cicdRoutes from './routes/cicd.js'
import publicApiRoutes from './routes/publicApi.js'
import apiTokenRoutes from './routes/apiTokens.js'
import docsRoutes from './routes/docs.js'
import schemeRoutes from './routes/schemes.js'
import workspaceRoutes from './routes/workspaces.js'
import { resolveWorkspace } from './middleware/workspace.js'
import { shouldServeStatic, setupStaticServing } from './serveStatic.js'
import { requestLogger } from './middleware/requestLogger.js'
import { logger } from './services/logger.js'
import healthRoutes from './routes/health.js'

// JL-90: fail fast on missing required environment variables (before any
// route wiring or listening). assertRequiredEnv only reports; we exit here.
const missingEnv = assertRequiredEnv()
if (missingEnv.length > 0) {
  console.error(`FATAL: missing required environment variable(s): ${missingEnv.join(', ')}`)
  console.error('Set them in your environment or .env file (see .env.example).')
  console.error('JWT_SECRET must be a strong random value, e.g. generate one with: openssl rand -hex 32')
  process.exit(1)
}

// JL-102: fail fast on insecure/incomplete secrets in production. Guarded so a
// misconfiguration surfaces clearly at boot without affecting dev/test (which
// are lenient) — assertValidConfig only throws for fatal production errors.
assertValidConfig()

const app = express()

// JL-98: correlation id + structured request/response logging (mounted early).
app.use(requestLogger)

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}))
app.use(express.json({ limit: '25mb' })) // 25mb accommodates base64 file uploads (Theme-1 #3 Attachments)

// JL-98: liveness (/api/health) + readiness (/api/ready) probes.
app.use('/api', healthRoutes)

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
// resolveWorkspace (JL-73) sets req.workspaceId from the X-Workspace-Id header
// or the caller's default workspace. It is best-effort and non-blocking, so it
// is safe to include on every protected route without changing existing behavior.
const protect = [authGuard, loadUserRoles, resolveWorkspace]

app.use('/api/workspaces', ...protect, workspaceRoutes)
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
app.use('/api', ...protect, workflowTransitionRoutes)
app.use('/api', ...protect, releaseRoutes)
app.use('/api', ...protect, goalRoutes)
app.use('/api', ...protect, issueConfigRoutes)
app.use('/api', ...protect, boardConfigRoutes)
app.use('/api', ...protect, slaRoutes)
app.use('/api', ...protect, gitIntegrationRoutes)
app.use('/api', ...protect, cicdRoutes)
app.use('/api', ...protect, schemeRoutes)

// JL-97: In production (or when SERVE_STATIC is set) serve the built frontend
// from /dist with an SPA history-fallback. Registered AFTER all /api routes so
// the catch-all never intercepts the API. No-op in the default dev setup where
// Vite serves the frontend and proxies /api to this server.
if (shouldServeStatic()) {
  setupStaticServing(app)
  console.log('Serving static frontend from /dist (SPA fallback enabled)')
}

app.use(errorHandler)

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      logger.info('server started', { port: PORT, url: `http://localhost:${PORT}` })
    })
  })
  .catch((err) => {
    logger.error('database init failed', { error: err?.message })
  })
