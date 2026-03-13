/**
 * Unified GitHub data sync + work dispatcher.
 * Single service: sync -> dispatch -> work
 * Fetches issues + PRs from GitHub, stores in PostgreSQL via Prisma, then dispatches work.
 */
import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'

const execFileAsync = promisify(execFile)
import { loadConfig, type Config } from './config.js'
import { MAINTENANCE_FILE } from '../paths.js'
import { logActivity } from './activity-log.js'
import { isRateLimited, handleRateLimitEvent } from './rate-limit.js'
import { isWorkerSlotFree, claimWorkerSlot, releaseWorkerSlot } from './worker-lock.js'
import { makeLogPath } from './worker.js'
import { getIssueState, setIssueState } from './state.js'
import { notify } from './notifier.js'
import { isRepoAllowed } from './allowed-repos.js'
import { scoreIssue, formatScore } from './prioritize.js'  // still used in handle_issue handler
import { handleIssue } from './github-poller.js'
import { handlePrReview } from './pr-poller.js'
import { handleConflict } from './conflict-poller.js'
import { hasStateChanged, resetSnapshot } from './state-diff.js'
import { buildUnifiedPlate, intelligentDispatch } from './intelligent-dispatch.js'
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
  // 1. Fetch issues assigned to the user
  const assignedRaw = gh(
    'search', 'issues',
    '--assignee', username,
    '--state', 'open',
    '--json', 'repository,number,title,labels,createdAt,updatedAt',
    '--limit', '50'
  )

  let assignedIssues: any[] = []
  if (assignedRaw) {
    try { assignedIssues = JSON.parse(assignedRaw) } catch { /* ignore */ }
  }

  // 2. Fetch issues where the user is mentioned
  const mentionedRaw = gh(
    'search', 'issues',
    '--mentions', username,
    '--state', 'open',
    '--json', 'repository,number,title,labels,createdAt,updatedAt',
    '--limit', '50'
  )

  let mentionedIssues: any[] = []
  if (mentionedRaw) {
    try { mentionedIssues = JSON.parse(mentionedRaw) } catch { /* ignore */ }
  }

  // 3. Merge both sets, deduplicating by repo+number (assigned takes priority)
  const issueMap = new Map<string, any>()
  for (const issue of assignedIssues) {
    const repo = issue.repository?.nameWithOwner || ''
    if (!repo) continue
    issueMap.set(`${repo}#${issue.number}`, issue)
  }
  for (const issue of mentionedIssues) {
    const repo = issue.repository?.nameWithOwner || ''
    if (!repo) continue
    const key = `${repo}#${issue.number}`
    if (!issueMap.has(key)) {
      issueMap.set(key, issue)
    }
  }

  const issues = Array.from(issueMap.values())

  // Track whether each search succeeded (returned valid JSON, even if empty)
  // vs failed (returned '' from gh() error). Empty string means gh CLI error.
  const assignedSucceeded = assignedRaw !== '' || assignedIssues.length > 0
  const mentionedSucceeded = mentionedRaw !== '' || mentionedIssues.length > 0

  if (issues.length === 0) {
    // If at least one search succeeded with 0 results, still run stale cleanup
    if (!assignedSucceeded && !mentionedSucceeded) {
      // Both searches failed (CLI errors) — skip cleanup to avoid false positives
      return 0
    }

    // At least one search succeeded — run stale cleanup below
    // (fall through with empty issues array)
  }

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
  // Only do stale cleanup if both queries returned less than 50 results (not truncated)
  if (assignedIssues.length < 50 && mentionedIssues.length < 50) {
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

  // Track which repo+number combos we've already processed (from per-repo author queries)
  const seenPrs = new Set<string>()

  // Helper to upsert a single PR into the DB
  async function upsertPr(repo: string, pr: any, author?: string) {
    const ciStatus = deriveCiStatus(pr.statusCheckRollup || null)

    // Extract linked issue numbers
    const linkedIssues = new Set<number>()

    const body: string = pr.body || ''
    let match: RegExpExecArray | null
    closingPattern.lastIndex = 0
    while ((match = closingPattern.exec(body)) !== null) {
      linkedIssues.add(parseInt(match[1], 10))
    }

    const repoParts = repo.split('/')
    const branchPrefix = repoParts.length === 2
      ? `ultradev/${repoParts[0]}_${repoParts[1]}_`
      : null

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
        author: author || username,
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
  }

  // --- Phase 1: Per-repo author queries (existing behavior) ---
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

    for (const pr of prs) {
      seenPrs.add(`${repo}#${pr.number}`)
      await upsertPr(repo, pr)
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

  // --- Phase 2: Cross-repo queries for mentions and review-requested ---
  // `gh search prs` returns a different JSON shape: repository.nameWithOwner for repo,
  // and field names like headRepositoryOwner, etc. We need to map fields accordingly.
  const searchJsonFields = 'repository,number,title,url,state,headRefName,baseRefName,body,createdAt,updatedAt,author'

  const mentionedRaw = gh(
    'search', 'prs',
    '--mentions', username,
    '--state', 'open',
    '--json', searchJsonFields,
    '--limit', '50'
  )

  const reviewRequestedRaw = gh(
    'search', 'prs',
    '--review-requested', username,
    '--state', 'open',
    '--json', searchJsonFields,
    '--limit', '50'
  )

  // Merge mentioned + review-requested, dedup by repo+number
  const crossRepoPrMap = new Map<string, any>()

  for (const raw of [mentionedRaw, reviewRequestedRaw]) {
    if (!raw) continue
    let prs: any[]
    try { prs = JSON.parse(raw) } catch { continue }

    for (const pr of prs) {
      const repo = pr.repository?.nameWithOwner || ''
      if (!repo) continue
      const key = `${repo}#${pr.number}`
      // Skip if already fetched via per-repo author query
      if (seenPrs.has(key)) continue
      if (!crossRepoPrMap.has(key)) {
        crossRepoPrMap.set(key, pr)
      }
    }
  }

  // For each cross-repo PR, we need more detail (mergeable, reviewDecision, statusCheckRollup, reviews)
  // that `gh search prs` doesn't return. Fetch individually via `gh pr view`.
  for (const [key, searchPr] of crossRepoPrMap) {
    const repo = searchPr.repository?.nameWithOwner || ''
    if (!repo) continue

    // Fetch full PR details (include author for correct attribution)
    const detailRaw = gh(
      'pr', 'view', String(searchPr.number),
      '--repo', repo,
      '--json', 'number,title,url,state,headRefName,baseRefName,body,mergeable,reviewDecision,statusCheckRollup,reviews,createdAt,updatedAt,author'
    )

    if (detailRaw) {
      let fullPr: any
      try { fullPr = JSON.parse(detailRaw) } catch { fullPr = null }
      if (fullPr) {
        const prAuthor = fullPr.author?.login || ''
        seenPrs.add(key)
        await upsertPr(repo, fullPr, prAuthor)
        totalPrs++
        continue
      }
    }

    // Fallback: upsert with what we have from the search result (limited fields)
    const fallbackAuthor = searchPr.author?.login || ''
    seenPrs.add(key)
    await upsertPr(repo, {
      number: searchPr.number,
      title: searchPr.title,
      url: searchPr.url,
      state: searchPr.state,
      headRefName: searchPr.headRefName || '',
      baseRefName: searchPr.baseRefName || '',
      body: searchPr.body || '',
      mergeable: 'UNKNOWN',
      reviewDecision: '',
      statusCheckRollup: [],
      reviews: [],
      createdAt: searchPr.createdAt,
      updatedAt: searchPr.updatedAt,
    }, fallbackAuthor)
    totalPrs++
  }

  // --- Phase 2 stale cleanup: mark cross-repo PRs as closed if no longer in results ---
  // Only clean up PRs NOT authored by the sync user (phase-2 PRs)
  const crossRepoNumbers = new Set(
    Array.from(crossRepoPrMap.keys()) // "repo#number" strings still in results
  )
  const dbCrossRepoPrs = await prisma.githubPr.findMany({
    where: {
      state: 'OPEN',
      NOT: { author: username },
    },
    select: { repo: true, number: true },
  })
  for (const dbPr of dbCrossRepoPrs) {
    const key = `${dbPr.repo}#${dbPr.number}`
    // Also skip if it was seen in phase 1 (per-repo author queries)
    if (!crossRepoNumbers.has(key) && !seenPrs.has(key)) {
      await prisma.githubPr.updateMany({
        where: { repo: dbPr.repo, number: dbPr.number, state: 'OPEN' },
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

    // Collect repos from open issues AND from open PRs already in the DB
    const issueRepoRows = await prisma.githubIssue.findMany({
      where: { assignee: username, state: 'OPEN' },
      distinct: ['repo'],
      select: { repo: true },
    })
    const prRepoRows = await prisma.githubPr.findMany({
      where: { author: username, state: 'OPEN' },
      distinct: ['repo'],
      select: { repo: true },
    })

    // Seed repos from a global authored-PR search to catch PRs in repos with no issues
    // (especially important on cold starts when the DB is empty)
    const authoredPrRepos: string[] = []
    const authoredSearchRaw = gh(
      'search', 'prs',
      '--author', username,
      '--state', 'open',
      '--json', 'repository',
      '--limit', '50'
    )
    if (authoredSearchRaw) {
      try {
        const authoredSearchResults = JSON.parse(authoredSearchRaw)
        for (const result of authoredSearchResults) {
          const repo = result.repository?.nameWithOwner
          if (repo) authoredPrRepos.push(repo)
        }
      } catch { /* ignore parse errors */ }
    }

    const repos = Array.from(new Set([
      ...issueRepoRows.map(r => r.repo),
      ...prRepoRows.map(r => r.repo),
      ...authoredPrRepos,
    ]))

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
// Default attempt limits — used only for notification display text.
// Claude decides whether to retry; these are informational fallbacks.
const DEFAULT_MAX_ISSUE_ATTEMPTS = 3
const DEFAULT_MAX_PR_ATTEMPTS = 3
const DEFAULT_MAX_CI_FIX_ATTEMPTS = 2

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
  dispatchStatus = 'dispatching'

  try {
    // --- 1. Query ALL open items from DB ---
    const allDbIssues = await prisma.githubIssue.findMany({ where: { state: 'OPEN' } })
    const allDbPrs = await prisma.githubPr.findMany({ where: { state: 'OPEN' } })

    // --- 2. Filter ONLY by isRepoAllowed (hard config filter) ---
    const allOpenIssues = []
    for (const issue of allDbIssues) {
      if (await isRepoAllowed(issue.repo)) allOpenIssues.push(issue)
    }
    const allOpenPrs = []
    for (const pr of allDbPrs) {
      if (await isRepoAllowed(pr.repo)) allOpenPrs.push(pr)
    }

    // --- 3. Build plate and dispatch ---
    const plate = buildUnifiedPlate(allOpenIssues, allOpenPrs)

    if (plate.items.length === 0) {
      console.log('[dispatch] No actionable work')
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

    // --- 4. Execute the decision ---
    // Track whether a handler took ownership of the worker slot
    // (handlePrReview, handleIssue, handleConflict all release the slot internally)
    let handlerOwnsSlot = false

    try {
      if (decision.action === 'handle_pr_review') {
        const pr = allOpenPrs.find(p => p.repo === decision.repo && p.number === decision.number)
        if (!pr) return
        const key = `pr:${pr.repo}#${pr.number}`
        const state = getIssueState(key)
        const { pc } = await getProjectConfig(pr.repo, config)
        const attempt = (state?.attempts || 0) + 1
        const isRetry = attempt > 1
        const maxAttempts = pc?.maxAttempts ?? DEFAULT_MAX_PR_ATTEMPTS

        logActivity('dispatch', `Picked: ${key} (intelligent: ${decision.reasoning})`)
        notify(isRetry
          ? `🔄 Retrying PR fix **${pr.repo}#${pr.number}** (attempt ${attempt}/${maxAttempts})...`
          : `🔍 Picked up changes requested: **${pr.repo}#${pr.number}** — ${pr.title}`
        )

        handlerOwnsSlot = true
        handlePrReview(pr.repo, {
          number: pr.number,
          title: pr.title,
          url: `https://github.com/${pr.repo}/pull/${pr.number}`,
          latest_review_at: pr.latestReviewAt?.toISOString() || null,
        }, config, state, pc ?? undefined)

      } else if (decision.action === 'handle_conflict') {
        const pr = allOpenPrs.find(p => p.repo === decision.repo && p.number === decision.number)
        if (!pr) return
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

        handlerOwnsSlot = true
        handleConflict(pr, config, logFile, attempt, pc ?? undefined)
          .finally(() => releaseWorkerSlot())

      } else if (decision.action === 'handle_issue') {
        const issue = allOpenIssues.find(i => i.repo === decision.repo && i.number === decision.number)
        if (!issue) return
        const key = `${issue.repo}#${issue.number}`
        const state = getIssueState(key)
        const { pc } = await getProjectConfig(issue.repo, config)
        const attempt = (state?.attempts || 0) + 1
        const isRetry = attempt > 1
        const maxAttempts = (pc?.maxAttempts ?? DEFAULT_MAX_ISSUE_ATTEMPTS) + DEFAULT_MAX_CI_FIX_ATTEMPTS

        const labels = Array.isArray(issue.labels) ? (issue.labels as string[]) : []
        const score = scoreIssue({ labels, createdAt: issue.createdAt?.toISOString() }, state)
        console.log(`[dispatch] Score: ${formatScore(key, score)}`)
        logActivity('dispatch', `Picked: ${key} (intelligent, score: ${score.total}: ${decision.reasoning})`)
        notify(isRetry
          ? `🔄 Retrying **${key}** (attempt ${attempt}/${maxAttempts})...`
          : `🔍 Picked up: **${key}** — ${issue.title}`
        )

        handlerOwnsSlot = true
        handleIssue({
          repository: { nameWithOwner: issue.repo },
          number: issue.number,
          title: issue.title,
        }, config, attempt, pc ?? undefined)

      } else if (decision.action === 'auto_merge') {
        const pr = allOpenPrs.find(p => p.repo === decision.repo && p.number === decision.number)
        if (!pr) return
        const key = `merge:${pr.repo}#${pr.number}`
        const state = getIssueState(key)
        const attempt = (state?.attempts || 0) + 1

        // Revalidate PR state against live GitHub data before merging
        let canMerge = true
        try {
          const { stdout: liveRaw } = await execFileAsync('gh', [
            'pr', 'view', String(pr.number),
            '--repo', pr.repo,
            '--json', 'state,mergeable,reviewDecision,statusCheckRollup',
          ], {
            encoding: 'utf-8',
            timeout: 15_000,
            env: { ...process.env, GH_PAGER: '' },
          })
          const livePr = JSON.parse(liveRaw.trim())
          const liveCi = deriveCiStatus(livePr.statusCheckRollup || null)
          if (livePr.state !== 'OPEN') {
            console.log(`[dispatch] Auto-merge skipped: ${pr.repo}#${pr.number} is no longer OPEN (${livePr.state})`)
            canMerge = false
          } else if (livePr.reviewDecision !== 'APPROVED') {
            console.log(`[dispatch] Auto-merge skipped: ${pr.repo}#${pr.number} review is ${livePr.reviewDecision}`)
            canMerge = false
          } else if (liveCi !== 'passing') {
            console.log(`[dispatch] Auto-merge skipped: ${pr.repo}#${pr.number} CI is ${liveCi}`)
            canMerge = false
          } else if (livePr.mergeable !== 'MERGEABLE') {
            console.log(`[dispatch] Auto-merge skipped: ${pr.repo}#${pr.number} mergeable is ${livePr.mergeable}`)
            canMerge = false
          }
        } catch (revalErr: any) {
          console.warn(`[dispatch] Auto-merge revalidation failed for ${pr.repo}#${pr.number}: ${revalErr.message} — skipping merge`)
          canMerge = false
        }

        if (!canMerge) {
          logActivity('dispatch', `Auto-merge skipped (revalidation failed): ${pr.repo}#${pr.number}`)
        } else {
          console.log(`[dispatch] Auto-merging: ${pr.repo}#${pr.number} — ${pr.title} (attempt ${attempt})`)
          logActivity('dispatch', `Auto-merging: ${pr.repo}#${pr.number} (intelligent: ${decision.reasoning})`)
          notify(`🚀 Auto-merging **${pr.repo}#${pr.number}** — ${pr.title}`)

          try {
            const { stdout: mergeOutput } = await execFileAsync('gh', [
              'pr', 'merge', String(pr.number),
              '--repo', pr.repo,
              '--squash',
              '--delete-branch',
            ], {
              encoding: 'utf-8',
              timeout: 30_000,
              env: { ...process.env, GH_PAGER: '' },
            })
            if (mergeOutput.trim()) console.log(`[dispatch] Merge output: ${mergeOutput.trim()}`)
            setIssueState(key, { status: 'done', attempts: attempt, repo: pr.repo, number: pr.number, type: 'merge' })
            notify(`✅ Merged **${pr.repo}#${pr.number}** — ${pr.title}`)
            logActivity('dispatch', `Merged: ${pr.repo}#${pr.number}`)
          } catch (mergeErr: any) {
            const errMsg = mergeErr?.stderr || mergeErr?.message || 'gh pr merge failed'
            console.error(`[dispatch] Auto-merge failed for ${pr.repo}#${pr.number}: ${errMsg}`)
            setIssueState(key, { status: 'failed', attempts: attempt, repo: pr.repo, number: pr.number, type: 'merge', error: errMsg })
            notify(`❌ Auto-merge failed for **${pr.repo}#${pr.number}**`)
          }
        }
      }
    } finally {
      // Release worker slot if no handler took ownership
      if (!handlerOwnsSlot) {
        releaseWorkerSlot()
      }
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
