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
import activityRoutes from './routes/activity.js'
import projectRoutes from './routes/projects.js'
import commentRoutes from './routes/comments.js'
import filterRoutes from './routes/filters.js'

const app = express()

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Public routes (no auth required)
app.use('/api/auth', authRoutes)

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
app.use('/api/activity', ...protect, activityRoutes)
app.use('/api/projects', ...protect, projectRoutes)
app.use('/api/issues', ...protect, commentRoutes)
app.use('/api/filters', ...protect, filterRoutes)

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
