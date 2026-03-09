import { execFileSync } from 'child_process'
import { getIssueState, setIssueState, getAllIssues } from './state.js'
import { spawnPrWorker } from './pr-worker.js'
import { makeLogPath } from './worker.js'
import { notify } from './notifier.js'
import { releaseWorkerSlot } from './worker-lock.js'
import { logActivity } from './activity-log.js'
import { loadConfig } from './config.js'
import { getPrsWithChangesRequested } from './github-sync.js'
import type { Config } from './config.js'
import type { IssueState } from './state.js'
import type { ProjectConfig } from '../lib/project-config.js'

const MAX_ATTEMPTS = 3

/** Cross-checks state.json with DB — clears stale pr: entries that no longer have CHANGES_REQUESTED */
export async function cleanStalePrStates(): Promise<void> {
  const issues = getAllIssues()
  let dbPrs: any[] | null = null

  for (const [key, state] of Object.entries(issues)) {
    if (!key.startsWith('pr:')) continue
    if (state.status !== 'failed' && state.status !== 'pending') continue

    // Lazy load DB PRs
    if (dbPrs === null) {
      try {
        const config = loadConfig()
        dbPrs = await getPrsWithChangesRequested(config.github.username)
      } catch { dbPrs = [] }
    }

    // Extract repo#number from key like "pr:owner/repo#123"
    const keyWithoutPrefix = key.slice(3) // remove "pr:"
    const [repo, numStr] = keyWithoutPrefix.split('#')
    const num = parseInt(numStr)

    const stillNeedsWork = dbPrs.some(p => p.repo === repo && p.number === num)
    if (!stillNeedsWork) {
      console.log(`[pr-poller] Clearing stale state for ${key} — no longer has changes_requested in DB`)
      setIssueState(key, { status: 'done' })
    }
  }
}




interface PrSummary {
  number: number
  title: string
  url: string
  latest_review_at?: string | null
}

export async function handlePrReview(repo: string, prSummary: PrSummary, config: Config, state: IssueState | null, projectConfig?: ProjectConfig) {
  const prNum = prSummary.number
  const key = `pr:${repo}#${prNum}`
  const reviewTimestamp = prSummary.latest_review_at || null

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
    // Note: dispatch already sends the "picked up" notification — don't duplicate here

    const logFile = makeLogPath(config, key)
    setIssueState(key, { status: 'in_progress', attempts: attempt, repo, number: prNum, type: 'pr', logFile })

    const result = await spawnPrWorker(repo, pr, reviews, reviewComments, config, logFile)

    const shouldNotifySuccess = projectConfig?.notifyOnSuccess ?? true
    const shouldNotifyFailure = projectConfig?.notifyOnFailure ?? true

    if (result.success && result.prUrl) {
      const existingUrls = getIssueState(key)?.prUrls || []
      const prUrls = existingUrls.includes(result.prUrl) ? existingUrls : [...existingUrls, result.prUrl]
      setIssueState(key, { status: 'done', prUrl: result.prUrl, prUrls, logFile: result.logFile, lastReviewAt: reviewTimestamp || undefined })
      if (shouldNotifySuccess) notify(`✅ **${repo}#${prNum}** — Review feedback pushed to PR: ${result.prUrl}`)
    } else if (result.success) {
      setIssueState(key, { status: 'done', logFile: result.logFile, lastReviewAt: reviewTimestamp || undefined })
      if (shouldNotifySuccess) notify(`✅ **${repo}#${prNum}** — Changes addressed (no new commits detected).`)
    } else if (result.partial) {
      setIssueState(key, { status: 'failed', error: result.error, madeProgress: true, logFile: result.logFile })
      if (shouldNotifyFailure) notify(`⏸️ **${repo}#${prNum}** — Partial progress, will retry.`)
    } else {
      setIssueState(key, { status: 'failed', error: result.error, logFile: result.logFile })
      if (shouldNotifyFailure) notify(`❌ **${repo}#${prNum}** — Failed (attempt ${attempt}): ${result.error}`)
    }
  } catch (err: any) {
    console.error(`[pr-poller] Error handling PR ${prNum}:`, err.message)
    setIssueState(key, { status: 'failed', error: err.message })
  } finally {
    releaseWorkerSlot()
  }
}

