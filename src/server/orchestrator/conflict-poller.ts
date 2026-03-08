import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { loadConfig } from './config.js'
import { MAINTENANCE_FILE } from '../paths.js'
import { getIssueState, setIssueState } from './state.js'
import { spawnConflictWorker } from './conflict-worker.js'
import { makeLogPath } from './worker.js'
import { notify } from './notifier.js'
import { isRateLimited } from './rate-limit.js'
import { isWorkerSlotFree, claimWorkerSlot, releaseWorkerSlot } from './worker-lock.js'
import { logActivity } from './activity-log.js'
import { isRepoAllowed } from './allowed-repos.js'
import { getConflictingPrs } from './github-sync.js'

const MAX_ATTEMPTS = 2
let lastPollTime: number | null = null
let pollStatus: 'idle' | 'polling' | 'error' = 'idle'
let intervalId: ReturnType<typeof setInterval> | null = null
let enabled = false

export function getConflictPollerState() {
  return { lastPollTime, pollStatus, enabled }
}

export function stopConflictPolling() {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  enabled = false
  console.log('[conflict-poller] Polling stopped')
}

export function updateConflictPollingInterval(intervalMs: number) {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  if (enabled) {
    intervalId = setInterval(pollConflicts, intervalMs)
    console.log(`[conflict-poller] Interval updated to ${intervalMs / 1000}s`)
  }
}

export async function pollConflicts() {
  if (existsSync(MAINTENANCE_FILE)) return
  if (isRateLimited()) return
  if (!isWorkerSlotFree()) return

  const config = loadConfig()
  const username = config.github.username
  pollStatus = 'polling'

  try {
    // Read from DB — no GitHub API call
    const conflictPrs = await getConflictingPrs(username)

    lastPollTime = Date.now()
    pollStatus = 'idle'

    for (const pr of conflictPrs) {
      if (!(await isRepoAllowed(pr.repo))) continue

      const key = `conflict:${pr.repo}#${pr.number}`
      const state = getIssueState(key)

      if (state?.status === 'done') continue
      if (state?.status === 'in_progress') {
        if (Date.now() - (state.updatedAt || 0) > 20 * 60 * 1000) {
          setIssueState(key, { status: 'failed', error: 'Timed out (stuck)' })
        }
        continue
      }
      if ((state?.attempts || 0) >= MAX_ATTEMPTS) {
        if (!state?.notifiedMaxRetries) {
          notify(`⚠️ **${key}** — Could not resolve merge conflicts after ${MAX_ATTEMPTS} attempts. Needs human help.`)
          setIssueState(key, { notifiedMaxRetries: true })
        }
        continue
      }

      if (!claimWorkerSlot()) break

      const attempt = (state?.attempts || 0) + 1
      console.log(`[conflict-poller] Merge conflict detected: ${pr.repo}#${pr.number} (attempt ${attempt})`)
      notify(`🔀 Resolving merge conflicts on **${pr.repo}#${pr.number}** — ${pr.title}`)
      logActivity('conflict-poller', `Picked up conflict: ${pr.repo}#${pr.number}`)

      const logFile = makeLogPath(config, key)
      setIssueState(key, {
        status: 'in_progress',
        attempts: attempt,
        repo: pr.repo,
        number: pr.number,
        type: 'conflict',
        logFile,
      })

      handleConflict(pr, config, logFile, attempt)
        .finally(() => releaseWorkerSlot())
      break
    }

    logActivity('conflict-poller', `Checked DB — ${conflictPrs.length} conflicting PR(s)`)
  } catch (err: any) {
    console.error('[conflict-poller] Error:', err.message)
    logActivity('conflict-poller', `Error: ${err.message}`)
    pollStatus = 'error'
    lastPollTime = Date.now()
  }
}

export async function handleConflict(pr: any, config: any, logFile: string, attempt: number) {
  const key = `conflict:${pr.repo}#${pr.number}`

  try {
    const result = await spawnConflictWorker(
      pr.repo,
      { number: pr.number, title: pr.title, url: `https://github.com/${pr.repo}/pull/${pr.number}` },
      pr.head_ref,
      pr.base_ref,
      config,
      logFile
    )

    if (result.success) {
      setIssueState(key, { status: 'done', prUrl: result.prUrl, logFile: result.logFile })
      notify(`✅ **${pr.repo}#${pr.number}** — Merge conflicts resolved and pushed`)
    } else if (result.partial) {
      setIssueState(key, { status: 'failed', error: result.error, madeProgress: true, logFile: result.logFile })
      notify(`⏸️ **${pr.repo}#${pr.number}** — Partial conflict resolution, will retry`)
    } else {
      setIssueState(key, { status: 'failed', error: result.error, logFile: result.logFile })
      notify(`❌ **${pr.repo}#${pr.number}** — Conflict resolution failed (attempt ${attempt}): ${result.error}`)
    }
  } catch (err: any) {
    setIssueState(key, { status: 'failed', error: err.message, logFile })
    notify(`❌ **${pr.repo}#${pr.number}** — Error: ${err.message}`)
  }
}

export function startConflictPolling() {
  const config = loadConfig()
  const interval = config.github.pollIntervalMs * 2

  if (intervalId !== null) {
    clearInterval(intervalId)
  }

  enabled = true
  console.log(`[conflict-poller] Polling merge conflicts every ${interval / 1000}s`)
  pollConflicts()
  intervalId = setInterval(pollConflicts, interval)
}
