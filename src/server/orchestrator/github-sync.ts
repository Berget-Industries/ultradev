/**
 * Unified GitHub data sync + work dispatcher.
 * Single service: sync -> dispatch -> work
 * Fetches issues + PRs from GitHub, stores in PostgreSQL via Prisma, then dispatches work.
 */
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { loadConfig, type Config } from './config.js'
import { MAINTENANCE_FILE } from '../paths.js'
import { logActivity } from './activity-log.js'
import { isRateLimited, handleRateLimitEvent } from './rate-limit.js'
import { isWorkerSlotFree, claimWorkerSlot, releaseWorkerSlot } from './worker-lock.js'
import { makeLogPath } from './worker.js'
import { getIssueState, setIssueState } from './state.js'
import { notify } from './notifier.js'
import { isRepoAllowed } from './allowed-repos.js'
import { scoreIssue, formatScore } from './prioritize.js'
import { handleIssue } from './github-poller.js'
import { handlePrReview, cleanStalePrStates } from './pr-poller.js'
import { handleConflict } from './conflict-poller.js'
import { hasStateChanged, resetSnapshot } from './state-diff.js'
import { buildPlate, intelligentDispatch } from './intelligent-dispatch.js'
import { prisma } from '../prisma.js'
import { resolveProjectConfig, type ProjectConfig } from '../lib/project-config.js'
import type { Project } from '@prisma/client'

let intervalId: ReturnType<typeof setInterval> | null = null
let lastSyncTime: number | null = null
let syncStatus: 'idle' | 'syncing' | 'error' = 'idle'
let enabled = false
let firstSyncDone = false

// Dispatch state
let lastDispatchTime: number | null = null
let dispatchStatus: 'idle' | 'dispatching' | 'error' = 'idle'
let dispatchEnabled = false

export function getGitHubSyncState() {
  return { lastSyncTime, syncStatus, enabled }
}

export function getDispatchState() {
  return { lastDispatchTime, dispatchStatus, enabled: dispatchEnabled }
}

function gh(...args: string[]): string {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, GH_PAGER: '' },
    }).trim()
  } catch (err: any) {
    const msg = err?.stderr || err?.message || ''
    if (/rate limit/i.test(msg)) {
      const match = msg.match(/resets?\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/i)
      const resetsAt = match ? Math.floor(new Date(match[1]).getTime() / 1000) : Math.floor(Date.now() / 1000) + 3600
      console.log(`[gh] Rate limit detected from CLI: ${msg.slice(0, 120)}`)
      handleRateLimitEvent({ status: 'rejected', resetsAt, rateLimitType: 'github-graphql' })
    }
    return ''
  }
}

// ---------------------------------------------------------------------------
// CI status derivation (shared logic)
// ---------------------------------------------------------------------------
export function deriveCiStatus(statusCheckRollup: any[] | null): 'passing' | 'failing' | 'pending' | 'none' {
  const checks = (statusCheckRollup || []).filter(
    (c: any) => c.name || c.context || c.status || c.conclusion
  )
  if (checks.length === 0) return 'none'
  if (checks.some(
    (c: any) => c.conclusion === 'FAILURE' || c.conclusion === 'failure' ||
                 c.conclusion === 'TIMED_OUT' || c.conclusion === 'timed_out'
  )) return 'failing'
  if (checks.some(
    (c: any) => c.status === 'IN_PROGRESS' || c.status === 'QUEUED' || c.status === 'PENDING' ||
                 c.status === 'in_progress' || c.status === 'queued' || c.status === 'pending'
  )) return 'pending'
  return 'passing'
}

// ---------------------------------------------------------------------------
// Sync issues
// ---------------------------------------------------------------------------
async function syncIssues(username: string) {
  const raw = gh(
    'search', 'issues',
    '--assignee', username,
    '--state', 'open',
    '--json', 'repository,number,title,labels,createdAt,updatedAt',
    '--limit', '50'
  )
  if (!raw) return 0

  let issues: any[]
  try { issues = JSON.parse(raw) } catch { return 0 }

  for (const issue of issues) {
    const repo = issue.repository?.nameWithOwner || ''
    if (!repo) continue

    const labels = (issue.labels || []).map((l: any) => typeof l === 'string' ? l : l.name || '')

    await prisma.githubIssue.upsert({
      where: { repo_number: { repo, number: issue.number } },
      update: {
        title: issue.title,
        state: 'OPEN',
        labels: labels,
        assignee: username,
        updatedAt: issue.updatedAt ? new Date(issue.updatedAt) : undefined,
        syncedAt: new Date(),
      },
      create: {
        repo,
        number: issue.number,
        title: issue.title,
        state: 'OPEN',
        labels: labels,
        assignee: username,
        createdAt: issue.createdAt ? new Date(issue.createdAt) : undefined,
        updatedAt: issue.updatedAt ? new Date(issue.updatedAt) : undefined,
        syncedAt: new Date(),
      },
    })
  }

  // Mark issues that are no longer open as closed (stale cleanup)
  if (issues.length < 50) {
    // Include repos from current results AND repos with open issues in DB
    const resultRepos = new Set(issues.map(i => i.repository?.nameWithOwner).filter(Boolean))
    const dbRepoRows = await prisma.githubIssue.findMany({
      where: { assignee: username, state: 'OPEN' },
      distinct: ['repo'],
      select: { repo: true },
    })
    const allRepos = new Set([...resultRepos, ...dbRepoRows.map(r => r.repo)])

    for (const repo of allRepos) {
      const repoIssueNums = issues
        .filter(i => i.repository?.nameWithOwner === repo)
        .map(i => i.number)
      await prisma.githubIssue.updateMany({
        where: {
          repo,
          assignee: username,
          state: 'OPEN',
          number: { notIn: repoIssueNums },
        },
        data: { state: 'CLOSED', syncedAt: new Date() },
      })
    }
  }

  return issues.length
}

// ---------------------------------------------------------------------------
// Sync PRs (per repo batch — one API call per repo)
// ---------------------------------------------------------------------------
async function syncPrs(username: string, repos: string[]) {
  const closingPattern = /(?:closes|fixes|resolves)\s+#(\d+)/gi

  const prState = firstSyncDone ? 'open' : 'all'
  let totalPrs = 0

  for (const repo of repos) {
    const raw = gh(
      'pr', 'list',
      '--repo', repo,
      '--author', username,
      '--state', prState,
      '--json', 'number,title,url,state,headRefName,baseRefName,body,mergeable,reviewDecision,statusCheckRollup,reviews,createdAt,updatedAt',
      '--limit', '50'
    )
    if (!raw) continue

    let prs: any[]
    try { prs = JSON.parse(raw) } catch { continue }

    const repoParts = repo.split('/')
    const branchPrefix = repoParts.length === 2
      ? `ultradev/${repoParts[0]}_${repoParts[1]}_`
      : null

    for (const pr of prs) {
      const ciStatus = deriveCiStatus(pr.statusCheckRollup || null)

      // Extract linked issue numbers
      const linkedIssues = new Set<number>()

      const body: string = pr.body || ''
      let match: RegExpExecArray | null
      closingPattern.lastIndex = 0
      while ((match = closingPattern.exec(body)) !== null) {
        linkedIssues.add(parseInt(match[1], 10))
      }

      const branch: string = pr.headRefName || ''
      if (branchPrefix && branch.startsWith(branchPrefix)) {
        const suffix = branch.slice(branchPrefix.length)
        const issueNum = parseInt(suffix, 10)
        if (!isNaN(issueNum) && issueNum > 0) {
          linkedIssues.add(issueNum)
        }
      }

      const changesRequestedReviews = (pr.reviews || [])
        .filter((r: any) => r.state === 'CHANGES_REQUESTED' && r.submittedAt)
        .map((r: any) => r.submittedAt)
        .sort()
      const latestReviewAt = changesRequestedReviews.length > 0
        ? changesRequestedReviews[changesRequestedReviews.length - 1]
        : null

      await prisma.githubPr.upsert({
        where: { repo_number: { repo, number: pr.number } },
        update: {
          title: pr.title,
          body,
          state: pr.state,
          headRef: pr.headRefName,
          baseRef: pr.baseRefName,
          mergeable: pr.mergeable || 'UNKNOWN',
          reviewDecision: pr.reviewDecision || '',
          ciStatus,
          statusCheckRollup: pr.statusCheckRollup || [],
          linkedIssueNumbers: Array.from(linkedIssues),
          latestReviewAt: latestReviewAt ? new Date(latestReviewAt) : null,
          updatedAt: pr.updatedAt ? new Date(pr.updatedAt) : undefined,
          syncedAt: new Date(),
        },
        create: {
          repo,
          number: pr.number,
          title: pr.title,
          body,
          state: pr.state,
          headRef: pr.headRefName,
          baseRef: pr.baseRefName,
          author: username,
          mergeable: pr.mergeable || 'UNKNOWN',
          reviewDecision: pr.reviewDecision || '',
          ciStatus,
          statusCheckRollup: pr.statusCheckRollup || [],
          linkedIssueNumbers: Array.from(linkedIssues),
          latestReviewAt: latestReviewAt ? new Date(latestReviewAt) : null,
          createdAt: pr.createdAt ? new Date(pr.createdAt) : undefined,
          updatedAt: pr.updatedAt ? new Date(pr.updatedAt) : undefined,
          syncedAt: new Date(),
        },
      })

      totalPrs++
    }

    // Mark PRs no longer returned by GitHub as closed (stale cleanup)
    if (prState === 'open' && prs.length < 50) {
      const fetchedNumbers = prs.map(p => p.number)
      await prisma.githubPr.updateMany({
        where: {
          repo,
          author: username,
          state: 'OPEN',
          number: { notIn: fetchedNumbers },
        },
        data: { state: 'CLOSED', syncedAt: new Date() },
      })
    }
  }

  return totalPrs
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------
export async function syncGitHub() {
  if (isRateLimited()) {
    console.log('[github-sync] Rate limited, skipping sync')
    return
  }

  const config = loadConfig()
  const username = config.github.username
  syncStatus = 'syncing'

  try {
    const issueCount = await syncIssues(username)

    if (isRateLimited()) {
      console.log('[github-sync] Rate limit hit during sync — aborting')
      syncStatus = 'idle'
      lastSyncTime = Date.now()
      return
    }

    const repoRows = await prisma.githubIssue.findMany({
      where: { assignee: username, state: 'OPEN' },
      distinct: ['repo'],
      select: { repo: true },
    })
    const repos = repoRows.map(r => r.repo)

    const prCount = await syncPrs(username, repos)

    lastSyncTime = Date.now()
    syncStatus = 'idle'
    firstSyncDone = true

    console.log(`[github-sync] Synced ${issueCount} issues, ${prCount} PRs across ${repos.length} repo(s)`)
    logActivity('github-sync', `Synced ${issueCount} issues, ${prCount} PRs`)

    // Check if anything meaningful changed before dispatching
    const diff = await hasStateChanged()
    if (!diff.changed) {
      console.log(`[github-sync] No state changes — skipping dispatch`)
      return
    }
    console.log(`[github-sync] State changed: ${diff.reason}`)
    logActivity('github-sync', `State changed: ${diff.reason}`)

    await dispatch()
  } catch (err: any) {
    console.error('[github-sync] Error:', err.message)
    logActivity('github-sync', `Error: ${err.message}`)
    syncStatus = 'error'
    lastSyncTime = Date.now()
  }
}

// ---------------------------------------------------------------------------
// Dispatch — decides what to work on after each sync
// ---------------------------------------------------------------------------
const MAX_ISSUE_ATTEMPTS = 3
const MAX_PR_ATTEMPTS = 3
const MAX_CONFLICT_ATTEMPTS = 2
const MAX_CI_FIX_ATTEMPTS = 2

/** Look up the Project for an owner/repo string and resolve per-project config. */
async function getProjectConfig(repo: string, config: Config): Promise<{ project: Project | null; pc: ProjectConfig | null }> {
  const project = await prisma.project.findFirst({
    where: {
      status: 'active',
      repoUrl: { endsWith: repo },
    },
  })
  if (!project) return { project: null, pc: null }
  return { project, pc: resolveProjectConfig(project, config) }
}

async function dispatch() {
  if (existsSync(MAINTENANCE_FILE)) {
    console.log('[dispatch] Maintenance mode — skipping')
    return
  }
  if (isRateLimited()) {
    console.log('[dispatch] Rate limited — skipping')
    return
  }
  if (!isWorkerSlotFree()) {
    console.log('[dispatch] Worker active (global lock) — skipping')
    return
  }

  const config = loadConfig()
  const username = config.github.username
  dispatchStatus = 'dispatching'

  try {
    await cleanStalePrStates()

    // --- Prepare state: reset stuck jobs, reset done PRs with new reviews ---
    const changesRequestedPrs = await getPrsWithChangesRequested(username)
    for (const pr of changesRequestedPrs) {
      const key = `pr:${pr.repo}#${pr.number}`
      const state = getIssueState(key)

      if (state?.status === 'done') {
        const latestReviewAt = pr.latestReviewAt?.toISOString() || null
        if (latestReviewAt && (!state.lastReviewAt || latestReviewAt > state.lastReviewAt)) {
          console.log(`[dispatch] ${key} has new review feedback (${latestReviewAt}) — resetting`)
          setIssueState(key, { status: 'pending', attempts: 0, notifiedMaxRetries: false })
        }
      }
      if (state?.status === 'in_progress' && Date.now() - (state.updatedAt || 0) > 20 * 60 * 1000) {
        setIssueState(key, { status: 'failed', error: 'Timed out (stuck)' })
      }
    }

    const conflictPrs = await getConflictingPrs(username)
    for (const pr of conflictPrs) {
      const key = `conflict:${pr.repo}#${pr.number}`
      const state = getIssueState(key)
      if (state?.status === 'in_progress' && Date.now() - (state.updatedAt || 0) > 20 * 60 * 1000) {
        setIssueState(key, { status: 'failed', error: 'Timed out (stuck)' })
      }
    }

    const dbIssues = await getOpenIssues(username)
    for (const issue of dbIssues) {
      const key = `${issue.repo}#${issue.number}`
      const state = getIssueState(key)

      // Re-queue done issues with failing CI on linked PRs
      if (state?.status === 'done') {
        const { pc } = await getProjectConfig(issue.repo, config)
        const maxAttempts = (pc?.maxAttempts ?? MAX_ISSUE_ATTEMPTS) + MAX_CI_FIX_ATTEMPTS
        const failingPrs = await getFailingPrsForIssue(username, issue.repo, issue.number)
        if (failingPrs.length > 0 && (state.attempts || 0) < maxAttempts) {
          const prNums = failingPrs.map(p => `#${p.number}`).join(', ')
          console.log(`[dispatch] ${key} marked done but PR ${prNums} has CI failures — re-queuing`)
          logActivity('dispatch', `Re-queuing ${key}: linked PR CI failing`)
          setIssueState(key, { status: 'failed', error: `CI still failing on ${prNums}`, notifiedMaxRetries: false })
          notify(`🔧 **${key}** — CI still failing on ${prNums}, re-queuing to fix`)
        }
      }
      if (state?.status === 'in_progress' && Date.now() - (state.updatedAt || 0) > 20 * 60 * 1000) {
        console.log(`[dispatch] ${key} appears stuck, marking for retry`)
        setIssueState(key, { status: 'failed', error: 'Timed out (stuck)' })
      }
    }

    // --- Filter to actionable items only (allowed repos, under max attempts, not done/in_progress) ---
    const actionableCrPrs = []
    for (const pr of changesRequestedPrs) {
      if (!(await isRepoAllowed(pr.repo))) continue
      const key = `pr:${pr.repo}#${pr.number}`
      const state = getIssueState(key)
      if (state?.status === 'done' || state?.status === 'in_progress') continue
      const { pc } = await getProjectConfig(pr.repo, config)
      const max = pc?.maxAttempts ?? MAX_PR_ATTEMPTS
      if ((state?.attempts || 0) >= max) {
        if (!state?.notifiedMaxRetries) {
          notify(`⚠️ **${key}** — Gave up after ${max} attempts on PR review. Needs human help.`)
          setIssueState(key, { notifiedMaxRetries: true })
        }
        continue
      }
      actionableCrPrs.push(pr)
    }

    const actionableConflicts = []
    for (const pr of conflictPrs) {
      if (!(await isRepoAllowed(pr.repo))) continue
      const key = `conflict:${pr.repo}#${pr.number}`
      const state = getIssueState(key)
      if (state?.status === 'done' || state?.status === 'in_progress') continue
      const { pc } = await getProjectConfig(pr.repo, config)
      const max = pc?.maxAttempts ?? MAX_CONFLICT_ATTEMPTS
      if ((state?.attempts || 0) >= max) {
        if (!state?.notifiedMaxRetries) {
          notify(`⚠️ **${key}** — Could not resolve merge conflicts after ${max} attempts. Needs human help.`)
          setIssueState(key, { notifiedMaxRetries: true })
        }
        continue
      }
      actionableConflicts.push(pr)
    }

    const actionableIssues = []
    for (const issue of dbIssues) {
      if (!(await isRepoAllowed(issue.repo))) continue
      const key = `${issue.repo}#${issue.number}`
      const state = getIssueState(key)
      if (state?.status === 'done' || state?.status === 'in_progress') continue
      const { pc } = await getProjectConfig(issue.repo, config)
      const max = (pc?.maxAttempts ?? MAX_ISSUE_ATTEMPTS) + MAX_CI_FIX_ATTEMPTS
      if ((state?.attempts || 0) >= max) {
        if (!state?.notifiedMaxRetries) {
          notify(`⚠️ **${key}** — Gave up after ${max} attempts (incl. CI fixes). Needs human help.`)
          setIssueState(key, { notifiedMaxRetries: true })
        }
        continue
      }
      actionableIssues.push(issue)
    }

    const actionableMerge = config.features.autoMerge ? await getMergeReadyPrs(username) : []
    const filteredMerge = []
    for (const pr of actionableMerge) {
      if (!(await isRepoAllowed(pr.repo))) continue
      const key = `merge:${pr.repo}#${pr.number}`
      const state = getIssueState(key)
      if (state?.status === 'done' || state?.status === 'in_progress') continue
      if ((state?.attempts || 0) >= 2) {
        if (!state?.notifiedMaxRetries) {
          notify(`⚠️ **${key}** — Auto-merge failed after 2 attempts. Needs human help.`)
          setIssueState(key, { notifiedMaxRetries: true })
        }
        continue
      }
      filteredMerge.push(pr)
    }

    // --- Ask Claude what to do ---
    const plate = buildPlate(actionableIssues, actionableCrPrs, actionableConflicts, filteredMerge)

    if (plate.items.length === 0) {
      lastDispatchTime = Date.now()
      dispatchStatus = 'idle'
      logActivity('dispatch', 'No actionable work found')
      return
    }

    const decision = await intelligentDispatch(plate, config)
    console.log(`[dispatch] 🧠 Claude decided: ${decision.action} ${decision.repo}#${decision.number} — ${decision.reasoning}`)

    if (decision.action === 'skip') {
      lastDispatchTime = Date.now()
      dispatchStatus = 'idle'
      logActivity('dispatch', `Skipped: ${decision.reasoning}`)
      return
    }

    if (!claimWorkerSlot()) {
      lastDispatchTime = Date.now()
      dispatchStatus = 'idle'
      return
    }

    // --- Execute the decision ---
    if (decision.action === 'handle_pr_review') {
      const pr = actionableCrPrs.find(p => p.repo === decision.repo && p.number === decision.number)
      if (!pr) { releaseWorkerSlot(); return }
      const key = `pr:${pr.repo}#${pr.number}`
      const state = getIssueState(key)
      const { pc } = await getProjectConfig(pr.repo, config)
      const attempt = (state?.attempts || 0) + 1
      const isRetry = attempt > 1
      const maxAttempts = pc?.maxAttempts ?? MAX_PR_ATTEMPTS

      logActivity('dispatch', `Picked: ${key} (intelligent: ${decision.reasoning})`)
      notify(isRetry
        ? `🔄 Retrying PR fix **${pr.repo}#${pr.number}** (attempt ${attempt}/${maxAttempts})...`
        : `🔍 Picked up changes requested: **${pr.repo}#${pr.number}** — ${pr.title}`
      )

      handlePrReview(pr.repo, {
        number: pr.number,
        title: pr.title,
        url: `https://github.com/${pr.repo}/pull/${pr.number}`,
        latest_review_at: pr.latestReviewAt?.toISOString() || null,
      }, config, state, pc ?? undefined)

    } else if (decision.action === 'handle_conflict') {
      const pr = actionableConflicts.find(p => p.repo === decision.repo && p.number === decision.number)
      if (!pr) { releaseWorkerSlot(); return }
      const key = `conflict:${pr.repo}#${pr.number}`
      const state = getIssueState(key)
      const { pc } = await getProjectConfig(pr.repo, config)
      const attempt = (state?.attempts || 0) + 1

      logActivity('dispatch', `Picked: ${key} (intelligent: ${decision.reasoning})`)
      notify(`🔀 Resolving merge conflicts on **${pr.repo}#${pr.number}** — ${pr.title}`)

      const logFile = makeLogPath(config, key)
      setIssueState(key, {
        status: 'in_progress',
        attempts: attempt,
        repo: pr.repo,
        number: pr.number,
        type: 'conflict',
        logFile,
      })

      handleConflict(pr, config, logFile, attempt, pc ?? undefined)
        .finally(() => releaseWorkerSlot())

    } else if (decision.action === 'handle_issue') {
      const issue = actionableIssues.find(i => i.repo === decision.repo && i.number === decision.number)
      if (!issue) { releaseWorkerSlot(); return }
      const key = `${issue.repo}#${issue.number}`
      const state = getIssueState(key)
      const { pc } = await getProjectConfig(issue.repo, config)
      const attempt = (state?.attempts || 0) + 1
      const isRetry = attempt > 1
      const maxAttempts = (pc?.maxAttempts ?? MAX_ISSUE_ATTEMPTS) + MAX_CI_FIX_ATTEMPTS

      const labels = Array.isArray(issue.labels) ? (issue.labels as string[]) : []
      const score = scoreIssue({ labels, createdAt: issue.createdAt?.toISOString() }, state)
      console.log(`[dispatch] Score: ${formatScore(key, score)}`)
      logActivity('dispatch', `Picked: ${key} (intelligent, score: ${score.total}: ${decision.reasoning})`)
      notify(isRetry
        ? `🔄 Retrying **${key}** (attempt ${attempt}/${maxAttempts})...`
        : `🔍 Picked up: **${key}** — ${issue.title}`
      )

      handleIssue({
        repository: { nameWithOwner: issue.repo },
        number: issue.number,
        title: issue.title,
      }, config, attempt, pc ?? undefined)

    } else if (decision.action === 'auto_merge') {
      const pr = filteredMerge.find(p => p.repo === decision.repo && p.number === decision.number)
      if (!pr) { releaseWorkerSlot(); return }
      const key = `merge:${pr.repo}#${pr.number}`
      const state = getIssueState(key)
      const attempt = (state?.attempts || 0) + 1

      console.log(`[dispatch] Auto-merging: ${pr.repo}#${pr.number} — ${pr.title} (attempt ${attempt}/2)`)
      logActivity('dispatch', `Auto-merging: ${pr.repo}#${pr.number} (intelligent: ${decision.reasoning})`)
      notify(`🚀 Auto-merging **${pr.repo}#${pr.number}** — ${pr.title}`)

      const result = gh(
        'pr', 'merge', String(pr.number),
        '--repo', pr.repo,
        '--squash',
        '--delete-branch'
      )

      if (result !== '') {
        console.log(`[dispatch] Merge output: ${result}`)
        setIssueState(key, { status: 'done', attempts: attempt, repo: pr.repo, number: pr.number, type: 'merge' })
        notify(`✅ Merged **${pr.repo}#${pr.number}** — ${pr.title}`)
        logActivity('dispatch', `Merged: ${pr.repo}#${pr.number}`)
      } else {
        console.error(`[dispatch] Auto-merge failed for ${pr.repo}#${pr.number}`)
        setIssueState(key, { status: 'failed', attempts: attempt, repo: pr.repo, number: pr.number, type: 'merge', error: 'gh pr merge returned empty' })
        notify(`❌ Auto-merge failed for **${pr.repo}#${pr.number}**`)
      }

      releaseWorkerSlot()
    }

    // Reset snapshot so next sync detects the worker becoming busy
    resetSnapshot()
    lastDispatchTime = Date.now()
    dispatchStatus = 'idle'
  } catch (err: any) {
    console.error('[dispatch] Error:', err.message)
    logActivity('dispatch', `Error: ${err.message}`)
    dispatchStatus = 'error'
    lastDispatchTime = Date.now()
  }
}

// ---------------------------------------------------------------------------
// hasPendingWork — returns true if dispatch would find actionable work
// ---------------------------------------------------------------------------
export async function hasPendingWork(): Promise<boolean> {
  const config = loadConfig()
  const username = config.github.username

  const changesRequestedPrs = await getPrsWithChangesRequested(username)
  for (const pr of changesRequestedPrs) {
    if (!(await isRepoAllowed(pr.repo))) continue
    const key = `pr:${pr.repo}#${pr.number}`
    const state = getIssueState(key)
    if (state?.status === 'done') {
      const latestReviewAt = pr.latestReviewAt?.toISOString() || null
      if (latestReviewAt && (!state.lastReviewAt || latestReviewAt > state.lastReviewAt)) return true
      continue
    }
    if (state?.status === 'in_progress') continue
    if ((state?.attempts || 0) >= MAX_PR_ATTEMPTS) continue
    return true
  }

  const conflictPrs = await getConflictingPrs(username)
  for (const pr of conflictPrs) {
    if (!(await isRepoAllowed(pr.repo))) continue
    const key = `conflict:${pr.repo}#${pr.number}`
    const state = getIssueState(key)
    if (state?.status === 'done' || state?.status === 'in_progress') continue
    if ((state?.attempts || 0) >= MAX_CONFLICT_ATTEMPTS) continue
    return true
  }

  const maxIssueAttempts = MAX_ISSUE_ATTEMPTS + MAX_CI_FIX_ATTEMPTS
  const dbIssues = await getOpenIssues(username)
  for (const i of dbIssues) {
    if (!(await isRepoAllowed(i.repo))) continue
    const key = `${i.repo}#${i.number}`
    const state = getIssueState(key)
    if (state?.status === 'done') {
      const failingPrs = await getFailingPrsForIssue(username, i.repo, i.number)
      if (failingPrs.length > 0 && (state.attempts || 0) < maxIssueAttempts) return true
      continue
    }
    if (state?.status === 'in_progress') continue
    if ((state?.attempts || 0) >= maxIssueAttempts) continue
    return true
  }

  // Check for auto-merge candidates
  if (config.features.autoMerge) {
    const mergeReadyPrs = await getMergeReadyPrs(username)
    for (const pr of mergeReadyPrs) {
      if (!(await isRepoAllowed(pr.repo))) continue
      const key = `merge:${pr.repo}#${pr.number}`
      const state = getIssueState(key)
      if (state?.status === 'done') continue
      return true
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// DB query helpers (Prisma — used by dispatch and routes)
// ---------------------------------------------------------------------------

/** Get open issues assigned to username */
export async function getOpenIssues(username: string) {
  return prisma.githubIssue.findMany({
    where: { assignee: username, state: 'OPEN' },
    orderBy: { number: 'asc' },
  })
}

/** Get all PRs by author for a set of repos */
export async function getPrsByRepos(username: string, repos: string[]) {
  if (repos.length === 0) return []
  return prisma.githubPr.findMany({
    where: { author: username, repo: { in: repos } },
    orderBy: { number: 'asc' },
  })
}

/** Get open PRs with merge conflicts */
export async function getConflictingPrs(username: string) {
  return prisma.githubPr.findMany({
    where: { author: username, state: 'OPEN', mergeable: 'CONFLICTING' },
  })
}

/** Get open PRs with CI failures linked to a specific issue */
export async function getFailingPrsForIssue(username: string, repo: string, issueNumber: number) {
  return prisma.githubPr.findMany({
    where: {
      author: username,
      repo,
      state: 'OPEN',
      ciStatus: 'failing',
      linkedIssueNumbers: { has: issueNumber },
    },
  })
}

/** Get open PRs with changes_requested reviews */
export async function getPrsWithChangesRequested(username: string) {
  return prisma.githubPr.findMany({
    where: { author: username, state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' },
  })
}

/** Get open PRs that are ready to merge (CI passing, mergeable, approved) */
export async function getMergeReadyPrs(username: string) {
  return prisma.githubPr.findMany({
    where: {
      author: username,
      state: 'OPEN',
      ciStatus: 'passing',
      mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED',
    },
  })
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startGitHubSync() {
  const config = loadConfig()
  const interval = config.github.pollIntervalMs

  if (intervalId !== null) {
    clearInterval(intervalId)
  }

  enabled = true
  dispatchEnabled = true
  console.log(`[github-sync] Syncing every ${interval / 1000}s (with dispatch)`)
  syncGitHub()
  intervalId = setInterval(syncGitHub, interval)
}

export function stopGitHubSync() {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  enabled = false
  dispatchEnabled = false
  console.log('[github-sync] Stopped')
}

export function updateGitHubSyncInterval(intervalMs: number) {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  if (enabled) {
    intervalId = setInterval(syncGitHub, intervalMs)
    console.log(`[github-sync] Interval updated to ${intervalMs / 1000}s`)
  }
}
