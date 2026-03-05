import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { loadConfig } from './config.js'
import { MAINTENANCE_FILE } from '../paths.js'
import { spawnWorker, makeLogPath } from './worker.js'
import { getIssueState, setIssueState } from './state.js'
import { notify } from './notifier.js'
import { isRateLimited } from './rate-limit.js'
import { isWorkerSlotFree, claimWorkerSlot, releaseWorkerSlot } from './worker-lock.js'

const MAX_ATTEMPTS = 3
let lastPollTime: number | null = null
let pollStatus: 'idle' | 'polling' | 'error' = 'idle'
let intervalId: ReturnType<typeof setInterval> | null = null
let enabled = false

export function getPollerState() {
  return { lastPollTime, pollStatus, activeWorkers: isWorkerSlotFree() ? 0 : 1, enabled }
}

export function stopPolling() {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  enabled = false
  console.log('[poller] Polling stopped')
}

export function updatePollingInterval(intervalMs: number) {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  if (enabled) {
    intervalId = setInterval(pollGitHub, intervalMs)
    console.log(`[poller] Interval updated to ${intervalMs / 1000}s`)
  }
}

export function pollGitHub() {
  // Maintenance mode — skip poll
  if (existsSync(MAINTENANCE_FILE)) {
    console.log('[poller] Maintenance mode — skipping poll')
    return
  }

  // Skip if rate limited
  if (isRateLimited()) {
    console.log('[poller] Rate limited, skipping poll')
    return
  }

  // Single task mode: skip if ANY worker is already running (global lock)
  if (!isWorkerSlotFree()) {
    console.log('[poller] Worker active (global lock), skipping poll')
    return
  }

  const config = loadConfig()
  const username = config.github.username
  pollStatus = 'polling'

  try {
    const raw = execFileSync('gh', [
      'search', 'issues',
      '--assignee', username,
      '--state', 'open',
      '--json', 'repository,number,title,url,labels',
      '--limit', '20',
    ], { encoding: 'utf-8', timeout: 30000 })

    const issues = JSON.parse(raw)
    lastPollTime = Date.now()
    pollStatus = 'idle'

    for (const issue of issues) {
      const key = `${issue.repository.nameWithOwner}#${issue.number}`
      const state = getIssueState(key)

      if (state?.status === 'done') continue

      if (state?.status === 'in_progress') {
        if (Date.now() - (state.updatedAt || 0) > 20 * 60 * 1000) {
          console.log(`[poller] ${key} appears stuck, marking for retry`)
          setIssueState(key, { status: 'failed', error: 'Timed out (stuck)' })
        }
        continue
      }

      if ((state?.attempts || 0) >= MAX_ATTEMPTS) {
        if (!state?.notifiedMaxRetries) {
          notify(`⚠️ **${key}** — Gave up after ${MAX_ATTEMPTS} attempts. Needs human help.`)
          setIssueState(key, { notifiedMaxRetries: true })
        }
        continue
      }

      const attempt = (state?.attempts || 0) + 1
      const isRetry = attempt > 1

      console.log(`[poller] ${isRetry ? 'Retrying' : 'New issue'}: ${key} (attempt ${attempt}/${MAX_ATTEMPTS})`)
      notify(isRetry
        ? `🔄 Retrying **${key}** (attempt ${attempt}/${MAX_ATTEMPTS})...`
        : `🔍 Picked up: **${key}** — ${issue.title}`
      )

      // Claim global slot BEFORE async call to prevent race
      if (!claimWorkerSlot()) {
        console.log('[poller] Could not claim worker slot, skipping')
        break
      }
      handleIssue(issue, config, attempt)
      // Single task — stop looking
      break
    }
  } catch (err: any) {
    console.error('[poller] Error polling GitHub:', err.message)
    pollStatus = 'error'
    lastPollTime = Date.now()
  }
}

async function handleIssue(issue: any, config: any, attempt: number) {
  const repo = issue.repository.nameWithOwner
  const num = issue.number
  const key = `${repo}#${num}`

  // activeWorkers already incremented by caller
  const logFile = makeLogPath(config, key)
  setIssueState(key, { status: 'in_progress', attempts: attempt, repo, number: num, logFile })

  try {
    const body = execFileSync('gh', [
      'issue', 'view', String(num),
      '--repo', repo,
      '--json', 'title,body,comments,labels',
    ], { encoding: 'utf-8', timeout: 15000 })

    const detail = JSON.parse(body)
    const existingPrUrl = getIssueState(key)?.prUrl || null
    const prompt = buildPrompt(repo, num, detail, existingPrUrl)

    notify(`⚙️ Working on **${key}** (attempt ${attempt})...`)
    const result = await spawnWorker(repo, prompt, config, key, logFile)

    if (result.success && result.prUrl) {
      setIssueState(key, { status: 'done', prUrl: result.prUrl, logFile: result.logFile })
      notify(`✅ **${key}** — PR created: ${result.prUrl}`)
    } else if (result.success) {
      setIssueState(key, { status: 'done', prUrl: null, logFile: result.logFile })
      notify(`✅ **${key}** — Completed (no PR URL captured).`)
    } else if (result.partial) {
      setIssueState(key, { status: 'failed', error: result.error, madeProgress: true, logFile: result.logFile })
      notify(`⏸️ **${key}** — Partial progress, will retry. (${result.error})`)
    } else {
      setIssueState(key, { status: 'failed', error: result.error, logFile: result.logFile })
      notify(`❌ **${key}** — Failed (attempt ${attempt}): ${result.error}`)
    }
  } catch (err: any) {
    console.error(`[poller] Error handling ${key}:`, err.message)
    setIssueState(key, { status: 'failed', error: err.message, logFile })
    notify(`❌ **${key}** — Error: ${err.message}`)
  } finally {
    releaseWorkerSlot()
  }
}


function buildPrompt(repo: string, number: number, detail: any, existingPrUrl: string | null): string {
  const comments = (detail.comments || [])
    .map((c: any) => `**${c.author.login}**: ${c.body}`)
    .join('\n\n')

  const ciWaitStep = `8. After pushing, wait for CI checks to complete. Run this in a loop every 30 seconds until all checks finish:
   \`gh pr checks <PR_NUMBER> --repo ${repo} --watch\`
   If any check fails, read the failure logs, fix the issue, commit, and push again. Repeat until CI is green.`

  const prInstructions = existingPrUrl
    ? `5. Commit your changes with a clear message referencing #${number}.
6. Push your commits to this branch: \`git push origin HEAD\`
7. The existing PR (${existingPrUrl}) will be updated automatically. Do NOT create a new PR.
${ciWaitStep}`
    : `5. Commit your changes with a clear message referencing #${number}.
6. Push this branch and create a pull request using \`gh pr create\`.
7. The PR title should reference the issue. The PR body should explain what you changed and why.
${ciWaitStep}`

  const resumeContext = existingPrUrl
    ? `## IMPORTANT: Resuming Previous Work

A PR already exists for this issue: ${existingPrUrl}
Before doing anything, check the current state:
1. Run \`git log --oneline -5\` to see what commits already exist on this branch.
2. Run \`gh pr checks <PR_NUMBER> --repo ${repo}\` to check CI status.
3. If all CI checks pass, your work is DONE — just output "All CI checks passing, nothing to do." and exit.
4. If CI is still running, wait for it: \`gh pr checks <PR_NUMBER> --repo ${repo} --watch\`
5. If CI failed, read the failure logs, fix the issues, and push again.
6. If the PR needs more work beyond CI fixes, proceed with the instructions below.

`
    : ''

  return `You are working on issue #${number} in ${repo}.

## Issue: ${detail.title}

${detail.body || 'No description provided.'}

${comments ? `## Comments\n\n${comments}` : ''}

${resumeContext}## Instructions

1. Read and understand the issue thoroughly.
2. Explore the codebase to understand the relevant code.
3. Implement the fix or feature described in the issue.
4. Make sure the code works — run tests if they exist. Use \`pnpm --filter <package> test\` to run tests.
${prInstructions}

## CRITICAL RULES
- **NEVER run \`pnpm install\`, \`pnpm add\`, \`npm install\`, or any dependency installation command.** Dependencies are already installed. If something appears missing, work around it — do NOT install.
- You are already on the correct branch. Do not create or switch branches.${existingPrUrl ? '\n- Do NOT create a new pull request. Push to the existing branch.' : ''}
- Do not ask questions — make reasonable decisions and proceed.`
}

export function startPolling() {
  const config = loadConfig()
  const interval = config.github.pollIntervalMs

  if (intervalId !== null) {
    clearInterval(intervalId)
  }

  enabled = true
  console.log(`[poller] Polling every ${interval / 1000}s as ${config.github.username} (single task mode)`)
  pollGitHub()
  intervalId = setInterval(pollGitHub, interval)
}
