import { Router } from 'express'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { loadConfig } from '../orchestrator/config.js'
import { DATA_DIR } from '../paths.js'

const router = Router()

const LOGS_DIR = loadConfig().paths.logs
const STATE_FILE = join(DATA_DIR, 'state.json')

interface TaskUsage {
  logFile: string
  issueKey: string
  repo: string
  number: number | null
  status: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  costUsd: number | null
  durationMs: number | null
  numTurns: number | null
  toolCalls: number
  date: string // YYYY-MM-DD
  timestamp: number
}

interface DailyUsage {
  date: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  taskCount: number
}

interface UsageResponse {
  today: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    costUsd: number
    taskCount: number
  }
  allTime: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    costUsd: number
    taskCount: number
  }
  daily: DailyUsage[]
  tasks: TaskUsage[]
}

// Cache parsed log results: filename -> { mtimeMs, result }
const logCache = new Map<string, { mtimeMs: number; result: TaskUsage | null }>()

function parseLogForUsage(logFile: string, filename: string): TaskUsage | null {
  try {
    const fstat = statSync(logFile)
    const cached = logCache.get(logFile)
    if (cached && cached.mtimeMs === fstat.mtimeMs) {
      return cached.result
    }

    const content = readFileSync(logFile, 'utf-8')
    const lines = content.trim().split('\n')

    let inputTokens = 0
    let outputTokens = 0
    let cacheCreationTokens = 0
    let cacheReadTokens = 0
    let costUsd: number | null = null
    let durationMs: number | null = null
    let numTurns: number | null = null
    let toolCalls = 0

    for (const line of lines) {
      try {
        const event = JSON.parse(line)

        if (event.type === 'assistant' && event.message?.usage) {
          const u = event.message.usage
          inputTokens += u.input_tokens || 0
          outputTokens += u.output_tokens || 0
          cacheCreationTokens += u.cache_creation_input_tokens || 0
          cacheReadTokens += u.cache_read_input_tokens || 0
        }

        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'tool_use') toolCalls++
          }
        }

        if (event.type === 'result' && event.subtype !== 'tool_result') {
          costUsd = event.total_cost_usd ?? event.cost_usd ?? costUsd
          durationMs = event.duration_ms ?? durationMs
          numTurns = event.num_turns ?? numTurns
        }
      } catch { /* skip bad lines */ }
    }

    const totalTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens

    // Extract issue key from filename: e.g. Flawless-Agency_klipped_485_1772571113717.log
    const match = filename.match(/^(.+?)_(\d+)_(\d+)\.log$/)
    const repoMatch = filename.match(/^([^_]+_[^_]+)_/)
    const repo = repoMatch ? repoMatch[1].replace('_', '/') : 'unknown'
    const number = match ? parseInt(match[2]) : null
    const tsMatch = filename.match(/_(\d{13})\.log$/)
    const timestamp = tsMatch ? parseInt(tsMatch[1]) : fstat.birthtimeMs || fstat.ctimeMs

    // Derive issue key
    let issueKey = filename.replace('.log', '')
    if (number) {
      issueKey = `${repo}#${number}`
    }

    // Get date from file creation time
    const fileDate = new Date(timestamp)
    const date = fileDate.toISOString().slice(0, 10)

    // Determine status from state file
    let status = 'unknown'
    try {
      const stateContent = readFileSync(STATE_FILE, 'utf-8')
      const state = JSON.parse(stateContent)
      if (state.issues) {
        for (const [_key, val] of Object.entries(state.issues) as [string, any][]) {
          if (val.logFile === logFile) {
            status = val.status || 'unknown'
            break
          }
        }
      }
    } catch { /* state file might not exist */ }

    if (durationMs === null) {
      try {
        const created = fstat.birthtimeMs || fstat.ctimeMs
        const modified = fstat.mtimeMs
        if (modified > created) durationMs = Math.round(modified - created)
      } catch { /* ok */ }
    }

    const result: TaskUsage = {
      logFile: filename,
      issueKey,
      repo,
      number,
      status,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      totalTokens,
      costUsd,
      durationMs,
      numTurns,
      toolCalls,
      date,
      timestamp,
    }

    logCache.set(logFile, { mtimeMs: fstat.mtimeMs, result })
    return result
  } catch {
    return null
  }
}

// Cache the full state for 10 seconds to avoid constant FS scans
let stateCache: { data: any; ts: number } | null = null

function loadState(): Record<string, any> {
  try {
    if (stateCache && Date.now() - stateCache.ts < 10_000) return stateCache.data
    const content = readFileSync(STATE_FILE, 'utf-8')
    const data = JSON.parse(content)
    stateCache = { data, ts: Date.now() }
    return data
  } catch {
    return { issues: {} }
  }
}

router.get('/', (_req, res) => {
  try {
    const files = readdirSync(LOGS_DIR).filter(f => f.endsWith('.log') && !f.startsWith('review_') && !f.startsWith('oom-'))
    const state = loadState()

    const tasks: TaskUsage[] = []

    for (const file of files) {
      const fullPath = join(LOGS_DIR, file)
      const result = parseLogForUsage(fullPath, file)
      if (result && result.totalTokens > 0) {
        // Enrich status from state
        if (state.issues) {
          for (const [_key, val] of Object.entries(state.issues) as [string, any][]) {
            if (val.logFile === fullPath) {
              result.status = val.status || result.status
              break
            }
          }
        }
        tasks.push(result)
      }
    }

    // Sort by timestamp desc
    tasks.sort((a, b) => b.timestamp - a.timestamp)

    // Today's stats
    const todayStr = new Date().toISOString().slice(0, 10)
    const todayTasks = tasks.filter(t => t.date === todayStr)

    const today = {
      inputTokens: todayTasks.reduce((s, t) => s + t.inputTokens, 0),
      outputTokens: todayTasks.reduce((s, t) => s + t.outputTokens, 0),
      totalTokens: todayTasks.reduce((s, t) => s + t.totalTokens, 0),
      costUsd: todayTasks.reduce((s, t) => s + (t.costUsd || 0), 0),
      taskCount: todayTasks.length,
    }

    const allTime = {
      inputTokens: tasks.reduce((s, t) => s + t.inputTokens, 0),
      outputTokens: tasks.reduce((s, t) => s + t.outputTokens, 0),
      totalTokens: tasks.reduce((s, t) => s + t.totalTokens, 0),
      costUsd: tasks.reduce((s, t) => s + (t.costUsd || 0), 0),
      taskCount: tasks.length,
    }

    // Daily aggregation (last 14 days)
    const dailyMap = new Map<string, DailyUsage>()
    for (let i = 0; i < 14; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const ds = d.toISOString().slice(0, 10)
      dailyMap.set(ds, { date: ds, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, taskCount: 0 })
    }

    for (const t of tasks) {
      const day = dailyMap.get(t.date)
      if (day) {
        day.inputTokens += t.inputTokens
        day.outputTokens += t.outputTokens
        day.totalTokens += t.totalTokens
        day.costUsd += t.costUsd || 0
        day.taskCount++
      }
    }

    const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date))

    const response: UsageResponse = { today, allTime, daily, tasks }
    res.json(response)
  } catch (err) {
    console.error('[usage] Error:', err)
    res.status(500).json({ error: 'Failed to compute usage' })
  }
})

export default router
