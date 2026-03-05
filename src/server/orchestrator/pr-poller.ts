import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { loadConfig } from './config.js'
import { MAINTENANCE_FILE } from '../paths.js'
import { getIssueState, setIssueState } from './state.js'
import { spawnPrWorker } from './pr-worker.js'
import { makeLogPath } from './worker.js'
import { notify } from './notifier.js'
import { isRateLimited } from './rate-limit.js'
import { isWorkerSlotFree, claimWorkerSlot, releaseWorkerSlot } from './worker-lock.js'
import { logActivity } from './activity-log.js'

const MAX_ATTEMPTS = 3
let lastPollTime: number | null = null
let pollStatus: 'idle' | 'polling' | 'error' = 'idle'
let intervalId: ReturnType<typeof setInterval> | null = null
let enabled = false

export function getPrPollerState() {
  return { lastPollTime, pollStatus, enabled }
}

export function stopPrPolling() {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  enabled = false
  console.log('[pr-poller] Polling stopped')
}

export function updatePrPollingInterval(intervalMs: number) {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  if (enabled) {
    intervalId = setInterval(pollPrReviews, intervalMs)
    console.log(`[pr-poller] Interval updated to ${intervalMs / 1000}s`)
  }
}

/**
 * Poll our own open PRs for "Changes Requested" reviews.
 * When found, spawn a worker to address the feedback.
 */
export function pollPrReviews() {
  if (existsSync(MAINTENANCE_FILE)) {
    console.log('[pr-poller] Maintenance mode — skipping poll')
    return
  }
  if (isRateLimited()) {
    console.log('[pr-poller] Rate limited, skipping poll')
    return
  }
  if (!isWorkerSlotFree()) {
    console.log('[pr-poller] Worker active (global lock), skipping poll')
    return
  }

  const config = loadConfig()
  const username = config.github.username
  pollStatus = 'polling'

  try {
    // List our open PRs
    const raw = execFileSync('gh', [
      'search', 'prs',
      '--author', username,
      '--state', 'open',
      '--review', 'changes_requested',
      '--json', 'repository,number,title,url',
      '--limit', '20',
    ], { encoding: 'utf-8', timeout: 30000 })

    lastPollTime = Date.now()
    pollStatus = 'idle'

    const prs = JSON.parse(raw)
    logActivity('pr-poller', `Polled PRs — ${prs.length} with changes requested`)
    if (prs.length === 0) return

    for (const pr of prs) {
      const repo = pr.repository.nameWithOwner
      const key = `pr:${repo}#${pr.number}`
      let state = getIssueState(key)

      // If marked done but GitHub still shows changes_requested,
      // check if there's a genuinely NEW review we haven't addressed yet
      if (state?.status === 'done') {
        const latestReviewAt = getLatestReviewTimestamp(repo, pr.number)
        if (!latestReviewAt || (state.lastReviewAt && latestReviewAt <= state.lastReviewAt)) {
          // No new review since we last addressed it — skip
          continue
        }
        console.log(`[pr-poller] ${key} has new review feedback (${latestReviewAt}) — resetting for another round`)
        setIssueState(key, { status: 'pending', attempts: 0, notifiedMaxRetries: false })
        state = getIssueState(key)
      }
      if (state?.status === 'in_progress') {
        if (Date.now() - (state.updatedAt || 0) > 20 * 60 * 1000) {
          setIssueState(key, { status: 'failed', error: 'Timed out (stuck)' })
        }
        continue
      }
      if ((state?.attempts || 0) >= MAX_ATTEMPTS) {
        if (!state?.notifiedMaxRetries) {
          notify(`⚠️ **${key}** — Gave up after ${MAX_ATTEMPTS} attempts on PR review. Needs human help.`)
          setIssueState(key, { notifiedMaxRetries: true })
        }
        continue
      }

      // Check if we can claim the slot
      if (!isWorkerSlotFree() || !claimWorkerSlot()) {
        console.log('[pr-poller] Worker slot taken, will try next cycle')
        break
      }

      handlePrReview(repo, pr, config, state)
      break // single task mode
    }
  } catch (err: any) {
    console.error('[pr-poller] Error polling PR reviews:', err.message)
    logActivity('pr-poller', `Error: ${err.message}`)
    pollStatus = 'error'
    lastPollTime = Date.now()
  }
}

/** Get the ISO timestamp of the most recent CHANGES_REQUESTED review on a PR */
function getLatestReviewTimestamp(repo: string, prNum: number): string | null {
  try {
    const raw = execFileSync('gh', [
      'pr', 'view', String(prNum), '--repo', repo,
      '--json', 'reviews',
      '--jq', '[.reviews[] | select(.state=="CHANGES_REQUESTED") | .submittedAt] | sort | last',
    ], { encoding: 'utf-8', timeout: 15000 })
    const ts = raw.trim()
    return ts || null
  } catch {
    return null
  }
}

async function handlePrReview(repo: string, prSummary: any, config: any, state: any) {
  const prNum = prSummary.number
  const key = `pr:${repo}#${prNum}`
  // Capture the latest review timestamp so we can record what we addressed
  const reviewTimestamp = getLatestReviewTimestamp(repo, prNum)

  try {
    // Get full PR details
    const prRaw = execFileSync('gh', [
      'pr', 'view', String(prNum),
      '--repo', repo,
      '--json', 'title,body,headRefName,baseRefName,reviews,comments,url,number',
    ], { encoding: 'utf-8', timeout: 15000 })

    const pr = JSON.parse(prRaw)

    // Get reviews with "changes requested"
    const reviews = (pr.reviews || []).filter((r: any) =>
      r.state === 'CHANGES_REQUESTED'
    )

    // Get inline review comments
    let reviewComments: any[] = []
    try {
      const commentsRaw = execFileSync('gh', [
        'api', `repos/${repo}/pulls/${prNum}/comments`,
        '--jq', '.[] | {body: .body, path: .path, line: .line, author: .user.login}',
      ], { encoding: 'utf-8', timeout: 15000 })

      if (commentsRaw.trim()) {
        reviewComments = commentsRaw.trim().split('\n').map(l => {
          try { return JSON.parse(l) } catch { return null }
        }).filter(Boolean)
      }
    } catch { /* no comments */ }

    if (reviews.length === 0 && reviewComments.length === 0) {
      releaseWorkerSlot()
      return
    }

    const attempt = (state?.attempts || 0) + 1
    const isRetry = attempt > 1

    console.log(`[pr-poller] ${isRetry ? 'Retrying' : 'New'} PR changes requested: ${repo}#${prNum} (attempt ${attempt})`)
    notify(isRetry
      ? `🔄 Retrying PR fix **${repo}#${prNum}** (attempt ${attempt}/${MAX_ATTEMPTS})...`
      : `🔍 Picked up changes requested: **${repo}#${prNum}** — ${pr.title}`
    )

    const logFile = makeLogPath(config, key)
    setIssueState(key, { status: 'in_progress', attempts: attempt, repo, number: prNum, type: 'pr', logFile })

    const result = await spawnPrWorker(repo, pr, reviews, reviewComments, config, logFile)

    if (result.success && result.prUrl) {
      setIssueState(key, { status: 'done', prUrl: result.prUrl, logFile: result.logFile, lastReviewAt: reviewTimestamp || undefined })
      notify(`✅ **${repo}#${prNum}** — Review feedback pushed to PR: ${result.prUrl}`)
    } else if (result.success) {
      setIssueState(key, { status: 'done', logFile: result.logFile, lastReviewAt: reviewTimestamp || undefined })
      notify(`✅ **${repo}#${prNum}** — Changes addressed (no new commits detected).`)
    } else if (result.partial) {
      setIssueState(key, { status: 'failed', error: result.error, madeProgress: true, logFile: result.logFile })
      notify(`⏸️ **${repo}#${prNum}** — Partial progress, will retry.`)
    } else {
      setIssueState(key, { status: 'failed', error: result.error, logFile: result.logFile })
      notify(`❌ **${repo}#${prNum}** — Failed (attempt ${attempt}): ${result.error}`)
    }
  } catch (err: any) {
    console.error(`[pr-poller] Error handling PR ${prNum}:`, err.message)
    setIssueState(key, { status: 'failed', error: err.message })
  } finally {
    releaseWorkerSlot()
  }
}

export function startPrPolling() {
  const config = loadConfig()
  const interval = config.github.pollIntervalMs

  if (intervalId !== null) {
    clearInterval(intervalId)
  }

  enabled = true
  console.log(`[pr-poller] Polling PR reviews every ${interval / 1000}s`)
  pollPrReviews()
  intervalId = setInterval(pollPrReviews, interval)
}
