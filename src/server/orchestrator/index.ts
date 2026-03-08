import { startGitHubSync, stopGitHubSync, updateGitHubSyncInterval, getGitHubSyncState, getDispatchState } from './github-sync.js'
import { startDiscordBot, getDiscordBotStatus } from './discord-bot.js'
import { startErrorWatcher, stopErrorWatcher, getErrorWatcherState, runErrorWatcher } from './error-watcher.js'
import { loadConfig, refreshConfig } from './config.js'
import { getMemoryState, getAllIssues, setIssueState } from './state.js'
import { parseLogStats } from './log-parser.js'
import { getRateLimitState, setOnResume } from './rate-limit.js'
import { isWorkerSlotFree } from './worker-lock.js'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { logActivity, getActivityLog } from './activity-log.js'
import { MAINTENANCE_FILE } from '../paths.js'
import { getAllowedRepos } from './allowed-repos.js'
import { prisma } from '../prisma.js'

const execFileAsync = promisify(execFile)
const startedAt = Date.now()

// --- CI Checks cache (30s TTL) ---

interface CiCheck {
  name: string
  status: string
  conclusion: string | null
}

interface CiCacheEntry {
  checks: CiCheck[]
  fetchedAt: number
}

const ciCache = new Map<string, CiCacheEntry>()
const CI_CACHE_TTL = 30_000

// --- PR lookup cache (look up PR by branch name) ---
interface PrLookupEntry {
  prUrl: string | null
  fetchedAt: number
}
const prLookupCache = new Map<string, PrLookupEntry>()
const PR_LOOKUP_TTL = 30_000

/** Look up PR URL by branch name — uses DB, no API calls */
async function lookupPrByBranch(repo: string, branchName: string): Promise<string | null> {
  const cacheKey = `${repo}:${branchName}`
  const cached = prLookupCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < PR_LOOKUP_TTL) {
    return cached.prUrl
  }

  try {
    const row = await prisma.githubPr.findFirst({
      where: { repo, headRef: branchName },
      select: { number: true },
    })
    const prUrl = row ? `https://github.com/${repo}/pull/${row.number}` : null
    prLookupCache.set(cacheKey, { prUrl, fetchedAt: Date.now() })
    return prUrl
  } catch {
    if (cached) return cached.prUrl
    return null
  }
}

/** Fetch CI checks from PostgreSQL (synced by github-sync) — no API calls */
async function fetchCiChecks(repo: string, prNumber: number): Promise<CiCheck[]> {
  const cacheKey = `${repo}#${prNumber}`
  const cached = ciCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CI_CACHE_TTL) {
    return cached.checks
  }

  try {
    const row = await prisma.githubPr.findFirst({
      where: { repo, number: prNumber },
      select: { statusCheckRollup: true },
    })
    const rollup = row?.statusCheckRollup || []
    const checks: CiCheck[] = (Array.isArray(rollup) ? rollup : []).map((c: any) => ({
      name: c.name || c.context || 'unknown',
      status: c.status || c.state || 'UNKNOWN',
      conclusion: c.conclusion || null,
    }))

    ciCache.set(cacheKey, { checks, fetchedAt: Date.now() })
    return checks
  } catch {
    if (cached) return cached.checks
    return []
  }
}

/** Reset any in_progress jobs to failed — but only if no Claude worker is actually running */
async function recoverStaleJobs() {
  // Check if a claude worker is still alive from before the restart
  let workerRunning = false
  try {
    const { stdout } = await execFileAsync('pgrep', ['-a', 'claude'], { encoding: 'utf-8', timeout: 5000 })
    workerRunning = stdout.includes('--print')
  } catch { /* no claude processes */ }

  if (workerRunning) {
    console.log('[recovery] Claude worker still running — skipping recovery to avoid killing active tasks')
    return
  }

  const issues = getAllIssues()
  let recovered = 0
  for (const [key, state] of Object.entries(issues)) {
    if (state.status === 'in_progress') {
      console.log(`[recovery] Resetting stale job: ${key}`)
      setIssueState(key, { status: 'failed', error: 'Recovered after restart' })
      recovered++
    }
  }
  if (recovered > 0) {
    console.log(`[recovery] Reset ${recovered} stale job(s) for retry`)
  } else {
    console.log('[recovery] No stale jobs found')
  }
}

export { getActivityLog }
export {
  startGitHubSync, stopGitHubSync, updateGitHubSyncInterval,
  startErrorWatcher, stopErrorWatcher, getErrorWatcherState, runErrorWatcher,
}

export async function startOrchestrator() {
  console.log('[ultradev] Starting orchestrator...')

  // Prime config from settings table
  const config = await refreshConfig()
  console.log(`[ultradev] GitHub user: ${config.github.username}`)
  console.log(`[ultradev] Repo dir: ${config.paths.repos}`)
  console.log(`[ultradev] Discord: ${config.discord.enabled ? 'enabled' : 'disabled'}`)

  await recoverStaleJobs()

  if (config.discord.enabled && config.discord.token) {
    await startDiscordBot()
  }

  // Start github-sync — drives everything: sync -> dispatch -> work
  startGitHubSync()
  startErrorWatcher()

  // Auto-resume after rate limit clears
  setOnResume(() => {
    console.log('[rate-limit] Auto-resuming github-sync')
    startGitHubSync()
  })

  logActivity('system', 'Orchestrator started')
  console.log('[ultradev] Orchestrator running.')

  // Warm the orchestrator state cache so the first SSE frame is instant
  getOrchestratorState().catch(() => {})
}

// --- Cached orchestrator state (avoid recomputing on every request/SSE tick) ---
let orchestratorCache: { data: Awaited<ReturnType<typeof computeOrchestratorState>>; ts: number } | null = null
const ORCHESTRATOR_CACHE_TTL = 5_000

async function computeOrchestratorState() {
  const config = loadConfig()
  const ghSync = getGitHubSyncState()
  const dispatchState = getDispatchState()

  const discordStatus = getDiscordBotStatus()
  const issues = getAllIssues()

  const allowed = await getAllowedRepos()

  return {
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    maintenance: existsSync(MAINTENANCE_FILE),
    rateLimit: getRateLimitState(),
    startedAt,
    config: {
      githubUsername: config.github.username,
      pollIntervalMs: config.github.pollIntervalMs,
      discordEnabled: config.discord.enabled,
      discordConnected: discordStatus === 'online',
    },
    allowedRepos: allowed ? [...allowed] : null,
    jobs: [
      {
        name: 'GitHub Sync',
        schedule: `Every ${config.github.pollIntervalMs / 1000}s`,
        lastRun: ghSync.lastSyncTime,
        status: ghSync.syncStatus,
        enabled: ghSync.enabled,
      },
      {
        name: 'Work Dispatcher',
        schedule: `Every ${config.github.pollIntervalMs / 1000}s`,
        lastRun: dispatchState.lastDispatchTime,
        status: dispatchState.dispatchStatus,
        activeWorkers: isWorkerSlotFree() ? 0 : 1,
        enabled: dispatchState.enabled,
      },
      {
        name: 'Error Watcher',
        schedule: `Every ${config.errorWatcher.intervalMs / 1000 / 60 / 60}h`,
        lastRun: getErrorWatcherState().lastRunTime,
        status: getErrorWatcherState().lastRunStatus,
        enabled: config.errorWatcher.enabled && !!config.errorWatcher.targetRepo,
      },
    ],
    discord: {
      status: discordStatus,
    },
    errorWatcher: getErrorWatcherState(),
    workQueue: await Promise.all(
      Object.entries(issues).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)).map(async ([key, state]) => {
        const logStats = state.logFile ? parseLogStats(state.logFile) : null
        const resolvedPrUrl = state.prUrl
          || logStats?.detectedPrUrl
          || (state.type === 'pr' && state.repo && state.number ? `https://github.com/${state.repo}/pull/${state.number}` : null)
          || (state.repo ? await lookupPrByBranch(state.repo, `ultradev/${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`) : null)

        const ciChecks = await (async () => {
          if (!resolvedPrUrl || typeof resolvedPrUrl !== 'string') return []
          const match = resolvedPrUrl.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/)
          if (!match) return []
          return fetchCiChecks(match[1], parseInt(match[2]))
        })()

        return {
          key,
          repo: state.repo || key.split('#')[0],
          number: state.number,
          type: state.type || (key.startsWith('pr:') ? 'pr' : key.startsWith('conflict:') ? 'conflict' : 'issue'),
          status: state.status,
          attempts: state.attempts || 0,
          prUrl: resolvedPrUrl,
          error: state.error || null,
          logFile: state.logFile || null,
          updatedAt: state.updatedAt || null,
          toolCalls: logStats?.toolCalls ?? 0,
          costUsd: logStats?.costUsd ?? null,
          durationMs: logStats?.durationMs ?? null,
          inputTokens: logStats?.inputTokens ?? 0,
          outputTokens: logStats?.outputTokens ?? 0,
          cacheCreationTokens: logStats?.cacheCreationTokens ?? 0,
          cacheReadTokens: logStats?.cacheReadTokens ?? 0,
          totalTokens: logStats?.totalTokens ?? 0,
          peakContext: logStats?.peakContext ?? 0,
          contextHistory: logStats?.contextHistory ?? [],
          recentTools: logStats?.recentTools ?? [],
          lastThinking: logStats?.lastThinking ?? null,
          currentTool: logStats?.currentTool ?? null,
          lastActivityMs: logStats?.lastActivityMs ?? null,
          detectedPrUrl: logStats?.detectedPrUrl ?? null,
          todoList: logStats?.todoList ?? [],
          thoughts: logStats?.thoughts ?? [],
          agentCount: logStats?.agentCount ?? 0,
          ciChecks,
        }
      })
    ),
  }
}

export async function getOrchestratorState() {
  const now = Date.now()
  if (orchestratorCache && now - orchestratorCache.ts < ORCHESTRATOR_CACHE_TTL) {
    return orchestratorCache.data
  }
  const data = await computeOrchestratorState()
  orchestratorCache = { data, ts: now }
  return data
}

/** Invalidate the orchestrator cache (call after mutations like requeue) */
export function invalidateOrchestratorCache() {
  orchestratorCache = null
}
