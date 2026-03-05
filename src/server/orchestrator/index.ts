import { startPolling, stopPolling, updatePollingInterval, getPollerState } from './github-poller.js'
import { startPrPolling, stopPrPolling, updatePrPollingInterval, getPrPollerState } from './pr-poller.js'
import { startDiscordBot, getDiscordBotStatus } from './discord-bot.js'
import { loadConfig } from './config.js'
import { getMemoryState, getAllIssues, setIssueState } from './state.js'
import { parseLogStats } from './log-parser.js'
import { getRateLimitState, setOnResume } from './rate-limit.js'
import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { logActivity, getActivityLog } from './activity-log.js'

import { MAINTENANCE_FILE } from '../paths.js'
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

function lookupPrByBranch(repo: string, branchName: string): string | null {
  const cacheKey = `${repo}:${branchName}`
  const cached = prLookupCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < PR_LOOKUP_TTL) {
    return cached.prUrl
  }

  try {
    const raw = execFileSync('gh', [
      'pr', 'list', '--repo', repo, '--head', branchName,
      '--json', 'number,url', '--limit', '1',
    ], { timeout: 10_000, encoding: 'utf-8' })
    const prs = JSON.parse(raw)
    const prUrl = prs.length > 0 ? prs[0].url : null
    prLookupCache.set(cacheKey, { prUrl, fetchedAt: Date.now() })
    return prUrl
  } catch {
    if (cached) return cached.prUrl
    return null
  }
}

function fetchCiChecks(repo: string, prNumber: number): CiCheck[] {
  const cacheKey = `${repo}#${prNumber}`
  const cached = ciCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CI_CACHE_TTL) {
    return cached.checks
  }

  try {
    const raw = execFileSync('gh', [
      'pr', 'view', String(prNumber),
      '--repo', repo,
      '--json', 'statusCheckRollup',
    ], { timeout: 10_000, encoding: 'utf-8' })

    const data = JSON.parse(raw)
    const rollup = data.statusCheckRollup || []
    const checks: CiCheck[] = rollup.map((c: any) => ({
      name: c.name || c.context || 'unknown',
      status: c.status || c.state || 'UNKNOWN',
      conclusion: c.conclusion || null,
    }))

    ciCache.set(cacheKey, { checks, fetchedAt: Date.now() })
    return checks
  } catch (err) {
    // On error, return cached (even if stale) or empty
    if (cached) return cached.checks
    return []
  }
}

/** Reset any in_progress jobs to failed — but only if no Claude worker is actually running */
function recoverStaleJobs() {
  // Check if a claude worker is still alive from before the restart
  let workerRunning = false
  try {
    const out = execFileSync('pgrep', ['-a', 'claude'], { encoding: 'utf-8', timeout: 5000 })
    workerRunning = out.includes('--print')
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
  startPolling, stopPolling, updatePollingInterval,
  startPrPolling, stopPrPolling, updatePrPollingInterval,
}

export async function startOrchestrator() {
  console.log('[ultradev] Starting orchestrator...')

  const config = loadConfig()
  console.log(`[ultradev] GitHub user: ${config.github.username}`)
  console.log(`[ultradev] Repo dir: ${config.paths.repos}`)
  console.log(`[ultradev] Discord: ${config.discord.enabled ? 'enabled' : 'disabled'}`)

  recoverStaleJobs()

  if (config.discord.enabled && config.discord.token) {
    await startDiscordBot()
  }

  startPolling()
  startPrPolling()

  // Auto-resume pollers after rate limit clears
  setOnResume(() => {
    console.log('[rate-limit] Auto-resuming all pollers')
    startPolling()
    startPrPolling()
  })

  logActivity('system', 'Orchestrator started')
  console.log('[ultradev] Orchestrator running.')
}

export function getOrchestratorState() {
  const config = loadConfig()
  const ghPoller = getPollerState()
  const prPoller = getPrPollerState()

  const discordStatus = getDiscordBotStatus()
  const issues = getAllIssues()

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
    jobs: [
      {
        name: 'Issue Poller',
        schedule: `Every ${config.github.pollIntervalMs / 1000}s`,
        lastRun: ghPoller.lastPollTime,
        status: ghPoller.pollStatus,
        activeWorkers: ghPoller.activeWorkers,
        enabled: ghPoller.enabled,
      },
      {
        name: 'PR Poller',
        schedule: `Every ${config.github.pollIntervalMs / 1000}s`,
        lastRun: prPoller.lastPollTime,
        status: prPoller.pollStatus,
        enabled: prPoller.enabled,
      },
    ],
    discord: {
      status: discordStatus,
    },
    workQueue: Object.entries(issues).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)).map(([key, state]) => {
      const logStats = state.logFile ? parseLogStats(state.logFile) : null
      const resolvedPrUrl = state.prUrl
        || logStats?.detectedPrUrl
        || (state.type === 'pr' && state.repo && state.number ? `https://github.com/${state.repo}/pull/${state.number}` : null)
        || (state.repo ? lookupPrByBranch(state.repo, `ultradev/${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`) : null)

      return {
        key,
        repo: state.repo || key.split('#')[0],
        number: state.number,
        type: state.type || (key.startsWith('pr:') ? 'pr' : 'issue'),
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
        ciChecks: (() => {
          if (!resolvedPrUrl || typeof resolvedPrUrl !== 'string') return []
          const match = resolvedPrUrl.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/)
          if (!match) return []
          return fetchCiChecks(match[1], parseInt(match[2]))
        })(),
      }
    }),
  }
}
