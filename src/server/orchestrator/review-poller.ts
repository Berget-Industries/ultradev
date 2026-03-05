import { execFileSync, spawn } from 'child_process'
import { mkdirSync, appendFileSync, existsSync } from 'fs'
import { join } from 'path'
import { loadConfig } from './config.js'
import { MAINTENANCE_FILE } from '../paths.js'
import { getAllIssues, setIssueState } from './state.js'
import { notify } from './notifier.js'
import { isRateLimited } from './rate-limit.js'
import { isWorkerSlotFree, claimWorkerSlot, releaseWorkerSlot } from './worker-lock.js'

let lastPollTime: number | null = null
let pollStatus: 'idle' | 'reviewing' | 'error' = 'idle'
let intervalId: ReturnType<typeof setInterval> | null = null
let enabled = false
let activeReview: string | null = null

const REVIEW_INTERVAL = 10 * 60 * 1000 // 10 min

export function getReviewPollerState() {
  return { lastPollTime, pollStatus, enabled, activeReview }
}

export function stopReviewPolling() {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  enabled = false
  console.log('[review-poller] Stopped')
}

export function startReviewPolling() {
  if (intervalId !== null) clearInterval(intervalId)
  enabled = true
  console.log(`[review-poller] Reviewing completed work every ${REVIEW_INTERVAL / 1000}s`)
  // Delay first run so it doesn't compete with startup
  setTimeout(pollForReviews, 30_000)
  intervalId = setInterval(pollForReviews, REVIEW_INTERVAL)
}

export function updateReviewPollingInterval(intervalMs: number) {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  if (enabled) {
    intervalId = setInterval(pollForReviews, intervalMs)
    console.log(`[review-poller] Interval updated to ${intervalMs / 1000}s`)
  }
}

export function pollForReviews() {
  // Maintenance mode — skip poll
  if (existsSync(MAINTENANCE_FILE)) {
    console.log('[review-poller] Maintenance mode — skipping poll')
    return
  }

  if (pollStatus === 'reviewing') {
    console.log('[review-poller] Already reviewing, skipping')
    return
  }
  if (isRateLimited()) {
    console.log('[review-poller] Rate limited, skipping')
    return
  }
  if (!isWorkerSlotFree()) {
    console.log('[review-poller] Worker active (global lock), skipping')
    return
  }

  const issues = getAllIssues()
  lastPollTime = Date.now()

  // Find done issues with PRs that haven't been self-reviewed
  const toReview = Object.entries(issues).filter(([_key, state]) =>
    state.status === 'done' &&
    state.prUrl &&
    !state.selfReviewed &&
    state.type !== 'pr' // don't review review-fix PRs
  )

  if (toReview.length === 0) {
    pollStatus = 'idle'
    return
  }

  // Review one at a time — claim global worker slot
  if (!claimWorkerSlot()) {
    console.log('[review-poller] Could not claim worker slot, skipping')
    pollStatus = 'idle'
    return
  }

  const [key, state] = toReview[0]
  reviewPr(key, state.repo!, state.number!, state.prUrl!).catch(err => {
    console.error(`[review-poller] Error reviewing ${key}:`, err.message)
  }).finally(() => {
    releaseWorkerSlot()
  })
}

async function reviewPr(issueKey: string, repo: string, issueNum: number, prUrl: string) {
  const prNumMatch = prUrl.match(/\/pull\/(\d+)/)
  if (!prNumMatch) {
    setIssueState(issueKey, { selfReviewed: true })
    return
  }
  const prNum = prNumMatch[1]

  pollStatus = 'reviewing'
  activeReview = issueKey
  console.log(`[review-poller] Reviewing ${issueKey} (PR #${prNum})`)

  try {
    // Check if PR is still open or merged
    const prStateRaw = execFileSync('gh', [
      'pr', 'view', prNum, '--repo', repo,
      '--json', 'state,title',
    ], { encoding: 'utf-8', timeout: 15000 })
    const prState = JSON.parse(prStateRaw)

    // Get the PR diff
    let diff: string
    try {
      diff = execFileSync('gh', [
        'pr', 'diff', prNum, '--repo', repo,
      ], { encoding: 'utf-8', timeout: 30000 })
    } catch {
      console.log(`[review-poller] Could not get diff for ${issueKey}, skipping`)
      setIssueState(issueKey, { selfReviewed: true })
      pollStatus = 'idle'
      activeReview = null
      return
    }

    if (!diff.trim()) {
      setIssueState(issueKey, { selfReviewed: true })
      pollStatus = 'idle'
      activeReview = null
      return
    }

    // Get the original issue for context
    let issueBody = ''
    try {
      const issueRaw = execFileSync('gh', [
        'issue', 'view', String(issueNum), '--repo', repo,
        '--json', 'title,body',
      ], { encoding: 'utf-8', timeout: 15000 })
      const issue = JSON.parse(issueRaw)
      issueBody = `## Issue: ${issue.title}\n\n${issue.body || 'No description.'}`
    } catch { /* ok, review without issue context */ }

    // Truncate diff if too long (keep first 15K chars)
    const maxDiff = 15_000
    const truncatedDiff = diff.length > maxDiff
      ? diff.slice(0, maxDiff) + '\n\n... (diff truncated)'
      : diff

    const prompt = buildReviewPrompt(repo, prNum, prState.title, issueBody, truncatedDiff)

    // Spawn Claude to review
    const config = loadConfig()
    const review = await runReview(prompt, config, issueKey)

    if (review) {
      // Post review as PR comment
      try {
        execFileSync('gh', [
          'pr', 'comment', prNum, '--repo', repo,
          '--body', review,
        ], { encoding: 'utf-8', timeout: 15000 })
        console.log(`[review-poller] Posted review for ${issueKey}`)
        notify(`🔍 Self-reviewed **${issueKey}** (PR #${prNum})`)
      } catch (err: any) {
        console.error(`[review-poller] Failed to post comment for ${issueKey}:`, err.message)
      }
    }

    setIssueState(issueKey, { selfReviewed: true })
  } catch (err: any) {
    console.error(`[review-poller] Error reviewing ${issueKey}:`, err.message)
    pollStatus = 'error'
  } finally {
    pollStatus = 'idle'
    activeReview = null
  }
}

function buildReviewPrompt(repo: string, prNum: string, prTitle: string, issueBody: string, diff: string): string {
  return `You are reviewing a pull request that YOU created as an AI developer (bergetUltraDev).
This is a self-review for accountability — be honest and critical about your own work.

## PR: ${prTitle} (#${prNum} in ${repo})

${issueBody}

## Diff

\`\`\`diff
${diff}
\`\`\`

## Review Instructions

Write a concise self-review covering:

1. **Correctness** — Does the code actually fix the issue? Any logic bugs?
2. **Edge cases** — What scenarios might break? Anything missed?
3. **Security** — Any injection, XSS, auth bypass, or other vulnerabilities introduced?
4. **Code quality** — Is the approach clean? Any obvious improvements?
5. **Risk** — What could go wrong in production? Rate as LOW/MEDIUM/HIGH.

Format your review as a clear markdown comment. Start with a one-line summary verdict:
- ✅ **LGTM** — if the code looks solid
- ⚠️ **Minor issues** — if there are small improvements needed
- ❌ **Needs fixes** — if there are real bugs or security issues

Keep the review under 500 words. Be specific — reference file names and line numbers from the diff.
Do NOT output anything except the review comment itself.`
}

function runReview(prompt: string, config: any, issueKey: string): Promise<string | null> {
  return new Promise((resolve) => {
    const logDir = config.paths.logs
    mkdirSync(logDir, { recursive: true })
    const safeName = issueKey.replace(/[^a-zA-Z0-9_-]/g, '_')
    const logFile = join(logDir, `review_${safeName}_${Date.now()}.log`)

    const child = spawn(config.claude.command, [
      ...config.claude.flags,
      '--print',
      prompt,
    ], {
      cwd: process.env.HOME!,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      timeout: 5 * 60 * 1000, // 5 min max for review
    })

    let output = ''

    child.stdout.on('data', (data: Buffer) => {
      output += data.toString()
      appendFileSync(logFile, data)
    })

    child.stderr.on('data', (data: Buffer) => {
      appendFileSync(logFile, data)
    })

    child.on('close', (code: number | null) => {
      console.log(`[review-poller] Review claude exited code ${code} for ${issueKey}`)
      if (code === 0 && output.trim()) {
        resolve(output.trim())
      } else {
        resolve(null)
      }
    })

    child.on('error', () => {
      resolve(null)
    })
  })
}
