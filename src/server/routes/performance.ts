import { Router } from 'express'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../paths.js'
import { loadConfig } from '../orchestrator/config.js'
import { cached } from '../cache.js'

const router = Router()

const LOGS_DIR = loadConfig().paths.logs
const STATE_FILE = join(DATA_DIR, 'state.json')

interface PerformanceStats {
  totalTasks: number
  successCount: number
  failedCount: number
  successRate: number
  prsOpened: number
  avgAttemptsPerTask: number
  avgDurationMs: number | null
  avgCostUsd: number | null
  totalCostUsd: number
  totalTokens: number
  totalToolCalls: number
  avgTokensPerTask: number
  avgToolCallsPerTask: number
  prsPerHour: number | null
  tasksPerDay: number | null
  repos: { name: string; tasks: number; prs: number; successRate: number }[]
  daily: {
    date: string
    tasks: number
    prs: number
    successes: number
    failures: number
    costUsd: number
    tokens: number
  }[]
}

function computePerformance(): PerformanceStats {
  // Load state
  let issues: Record<string, any> = {}
  try {
    const content = readFileSync(STATE_FILE, 'utf-8')
    const state = JSON.parse(content)
    issues = state.issues || {}
  } catch { /* no state */ }

  // Parse log files for token/cost data (reuse usage.ts cache approach)
  const logCache = new Map<string, { tokens: number; cost: number | null; duration: number | null; toolCalls: number }>()
  try {
    const files = readdirSync(LOGS_DIR).filter(f => f.endsWith('.log') && !f.startsWith('review_') && !f.startsWith('oom-'))
    for (const file of files) {
      const fullPath = join(LOGS_DIR, file)
      try {
        const content = readFileSync(fullPath, 'utf-8')
        const lines = content.trim().split('\n')
        let totalTokens = 0
        let costUsd: number | null = null
        let durationMs: number | null = null
        let toolCalls = 0

        for (const line of lines) {
          try {
            const event = JSON.parse(line)
            if (event.type === 'assistant' && event.message?.usage) {
              const u = event.message.usage
              totalTokens += (u.input_tokens || 0) + (u.output_tokens || 0) +
                (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
            }
            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'tool_use') toolCalls++
              }
            }
            if (event.type === 'result' && event.subtype !== 'tool_result') {
              costUsd = event.total_cost_usd ?? event.cost_usd ?? costUsd
              durationMs = event.duration_ms ?? durationMs
            }
          } catch { /* skip bad lines */ }
        }

        if (durationMs === null) {
          try {
            const fstat = statSync(fullPath)
            const created = fstat.birthtimeMs || fstat.ctimeMs
            const modified = fstat.mtimeMs
            if (modified > created) durationMs = Math.round(modified - created)
          } catch { /* ok */ }
        }

        logCache.set(fullPath, { tokens: totalTokens, cost: costUsd, duration: durationMs, toolCalls })
      } catch { /* skip unreadable */ }
    }
  } catch { /* no logs dir */ }

  const entries = Object.entries(issues) as [string, any][]
  const allTasks = entries.filter(([, v]) => v.status === 'done' || v.status === 'failed')

  let successCount = 0
  let failedCount = 0
  let prsOpened = 0
  let totalAttempts = 0
  let totalDuration = 0
  let durationCount = 0
  let totalCost = 0
  let totalTokens = 0
  let totalToolCalls = 0

  const repoMap = new Map<string, { tasks: number; prs: number; successes: number }>()
  const dailyMap = new Map<string, { tasks: number; prs: number; successes: number; failures: number; costUsd: number; tokens: number }>()

  // Track earliest and latest timestamps for rate calculations
  let earliestTs: number | null = null
  let latestTs: number | null = null

  for (const [, val] of allTasks) {
    const isDone = val.status === 'done'
    const hasPr = !!(val.prUrl || val.detectedPrUrl)

    if (isDone) successCount++
    else failedCount++

    if (hasPr) prsOpened++
    totalAttempts += val.attempts || 1

    // Log-derived metrics
    const logData = val.logFile ? logCache.get(val.logFile) : null
    if (logData) {
      totalTokens += logData.tokens
      totalToolCalls += logData.toolCalls
      if (logData.cost !== null) totalCost += logData.cost
      if (logData.duration !== null) {
        totalDuration += logData.duration
        durationCount++
      }
    }

    // Timestamp tracking
    const ts = val.updatedAt || null
    if (ts) {
      if (!earliestTs || ts < earliestTs) earliestTs = ts
      if (!latestTs || ts > latestTs) latestTs = ts
    }

    // Per-repo
    const repo = val.repo || 'unknown'
    const r = repoMap.get(repo) || { tasks: 0, prs: 0, successes: 0 }
    r.tasks++
    if (hasPr) r.prs++
    if (isDone) r.successes++
    repoMap.set(repo, r)

    // Per-day
    if (ts) {
      const date = new Date(ts).toISOString().slice(0, 10)
      const d = dailyMap.get(date) || { tasks: 0, prs: 0, successes: 0, failures: 0, costUsd: 0, tokens: 0 }
      d.tasks++
      if (hasPr) d.prs++
      if (isDone) d.successes++
      else d.failures++
      if (logData?.cost) d.costUsd += logData.cost
      if (logData?.tokens) d.tokens += logData.tokens
      dailyMap.set(date, d)
    }
  }

  const totalTasks = allTasks.length

  // PRs per hour (based on time span of all completed work)
  let prsPerHour: number | null = null
  let tasksPerDay: number | null = null
  if (earliestTs && latestTs && latestTs > earliestTs) {
    const spanHours = (latestTs - earliestTs) / 3_600_000
    const spanDays = spanHours / 24
    if (spanHours > 0) prsPerHour = Math.round((prsOpened / spanHours) * 100) / 100
    if (spanDays > 0) tasksPerDay = Math.round((totalTasks / spanDays) * 100) / 100
  }

  const repos = [...repoMap.entries()]
    .map(([name, r]) => ({
      name,
      tasks: r.tasks,
      prs: r.prs,
      successRate: r.tasks > 0 ? Math.round((r.successes / r.tasks) * 100) : 0,
    }))
    .sort((a, b) => b.tasks - a.tasks)

  // Last 14 days for daily chart
  const dailyArr: PerformanceStats['daily'] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const ds = d.toISOString().slice(0, 10)
    const entry = dailyMap.get(ds) || { tasks: 0, prs: 0, successes: 0, failures: 0, costUsd: 0, tokens: 0 }
    dailyArr.push({ date: ds, ...entry })
  }

  return {
    totalTasks,
    successCount,
    failedCount,
    successRate: totalTasks > 0 ? Math.round((successCount / totalTasks) * 100) : 0,
    prsOpened,
    avgAttemptsPerTask: totalTasks > 0 ? Math.round((totalAttempts / totalTasks) * 100) / 100 : 0,
    avgDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : null,
    avgCostUsd: totalTasks > 0 ? Math.round((totalCost / totalTasks) * 10000) / 10000 : null,
    totalCostUsd: Math.round(totalCost * 10000) / 10000,
    totalTokens,
    totalToolCalls,
    avgTokensPerTask: totalTasks > 0 ? Math.round(totalTokens / totalTasks) : 0,
    avgToolCallsPerTask: totalTasks > 0 ? Math.round(totalToolCalls / totalTasks) : 0,
    prsPerHour,
    tasksPerDay,
    repos,
    daily: dailyArr,
  }
}

router.get('/', async (_req, res) => {
  try {
    const data = await cached<PerformanceStats>('performance:all', 60, computePerformance)
    res.json(data)
  } catch (err) {
    console.error('[performance] Error:', err)
    res.status(500).json({ error: 'Failed to compute performance stats' })
  }
})

export default router
