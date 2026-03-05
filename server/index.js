import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { initializeDatabase } from './db.js'
import { PORT } from './config.js'
import { errorHandler } from './middleware/errorHandler.js'
import { authGuard } from './middleware/authGuard.js'
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

// Protected routes (JWT required)
app.use('/api/issues', authGuard, issueRoutes)
app.use('/api/sprints', authGuard, sprintRoutes)
app.use('/api/dashboard', authGuard, dashboardRoutes)
app.use('/api/reports', authGuard, reportRoutes)
app.use('/api/roadmap', authGuard, roadmapRoutes)
app.use('/api/workflows', authGuard, workflowRoutes)
app.use('/api/profile', authGuard, profileRoutes)
app.use('/api/members', authGuard, memberRoutes)
app.use('/api/activity', authGuard, activityRoutes)
app.use('/api/projects', authGuard, projectRoutes)
app.use('/api/issues', authGuard, commentRoutes)

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
