import { createHash } from 'crypto'
import { isWorkerSlotFree } from './worker-lock.js'
import { isRepoAllowed } from './allowed-repos.js'
import { prisma } from '../prisma.js'

interface StateSnapshot {
  hash: string
  timestamp: number
  issueCount: number
  prCount: number
  workerFree: boolean
}

let previousSnapshot: StateSnapshot | null = null

export async function hasStateChanged(): Promise<{ changed: boolean; reason: string; snapshot: StateSnapshot }> {
  // Query ALL open issues, then filter by isRepoAllowed (same filter as dispatch)
  const allIssues = await prisma.githubIssue.findMany({
    where: { state: 'OPEN' },
    select: { repo: true, number: true, updatedAt: true },
    orderBy: { number: 'asc' },
  })
  const issues = []
  for (const i of allIssues) {
    if (await isRepoAllowed(i.repo)) issues.push(i)
  }

  // Query ALL open PRs, then filter by isRepoAllowed (same filter as dispatch)
  const allPrs = await prisma.githubPr.findMany({
    where: { state: 'OPEN' },
    select: { repo: true, number: true, updatedAt: true, reviewDecision: true, ciStatus: true, mergeable: true, latestReviewAt: true },
    orderBy: { number: 'asc' },
  })
  const prs = []
  for (const pr of allPrs) {
    if (await isRepoAllowed(pr.repo)) prs.push(pr)
  }

  const workerFree = isWorkerSlotFree()

  // Build fingerprint from meaningful fields
  const parts: string[] = []

  for (const i of issues) {
    parts.push(`issue:${i.repo}#${i.number}:${i.updatedAt?.toISOString() || ''}`)
  }

  for (const pr of prs) {
    parts.push(`pr:${pr.repo}#${pr.number}:${pr.updatedAt?.toISOString() || ''}:${pr.reviewDecision}:${pr.ciStatus}:${pr.mergeable}:${pr.latestReviewAt?.toISOString() || ''}`)
  }

  parts.push(`worker:${workerFree}`)

  const hash = createHash('sha256').update(parts.sort().join('|')).digest('hex').slice(0, 16)

  const snapshot: StateSnapshot = {
    hash,
    timestamp: Date.now(),
    issueCount: issues.length,
    prCount: prs.length,
    workerFree,
  }

  if (!previousSnapshot) {
    previousSnapshot = snapshot
    return { changed: true, reason: 'first sync (no previous snapshot)', snapshot }
  }

  if (hash === previousSnapshot.hash) {
    // Update timestamp but keep same hash
    previousSnapshot = snapshot
    return { changed: false, reason: 'no state changes', snapshot }
  }

  // Determine what changed for logging
  const reasons: string[] = []
  if (snapshot.issueCount !== previousSnapshot.issueCount) {
    reasons.push(`issues: ${previousSnapshot.issueCount} → ${snapshot.issueCount}`)
  }
  if (snapshot.prCount !== previousSnapshot.prCount) {
    reasons.push(`prs: ${previousSnapshot.prCount} → ${snapshot.prCount}`)
  }
  if (snapshot.workerFree !== previousSnapshot.workerFree) {
    reasons.push(`worker: ${previousSnapshot.workerFree ? 'free' : 'busy'} → ${snapshot.workerFree ? 'free' : 'busy'}`)
  }
  if (reasons.length === 0) {
    reasons.push('item details changed (updatedAt, reviews, CI, mergeable)')
  }

  previousSnapshot = snapshot
  return { changed: true, reason: reasons.join(', '), snapshot }
}

/** Force reset — useful after worker completes */
export function resetSnapshot() {
  previousSnapshot = null
}

export type { StateSnapshot }
