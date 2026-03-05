import express from 'express'
import { createServer } from 'vite'
import projectsRouter from './routes/projects.js'
import tasksRouter from './routes/tasks.js'
import cronjobsRouter from './routes/cronjobs.js'
import agentsRouter from './routes/agents.js'
import orchestratorRouter from './routes/orchestrator.js'
import logsRouter from './routes/logs.js'
import statsRouter from './routes/stats.js'
import maintenanceRouter from './routes/maintenance.js'
import usageRouter from './routes/usage.js'
import issuesRouter from './routes/issues.js'
import { startOrchestrator } from './orchestrator/index.js'

const app = express()
const PORT = parseInt(process.env.PORT || '4800', 10)

app.use(express.json())

// API routes
app.use('/api/projects', projectsRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/cronjobs', cronjobsRouter)
app.use('/api/agents', agentsRouter)
app.use('/api/orchestrator', orchestratorRouter)
app.use('/api/logs', logsRouter)
app.use('/api/stats', statsRouter)
app.use('/api/maintenance', maintenanceRouter)
app.use('/api/usage', usageRouter)
app.use('/api/issues', issuesRouter)

async function start() {
  // Vite dev middleware
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`UltraDev Dashboard running at http://127.0.0.1:${PORT}`)
  })

  // Start orchestrator (pollers + discord) in the same process
  startOrchestrator().catch(err => {
    console.error('[ultradev] Orchestrator failed to start:', err)
  })
}

start().catch(console.error)
