import { createHash } from 'crypto'
import { loadConfig } from './config.js'
import { isWorkerSlotFree } from './worker-lock.js'
import { getOpenIssues, getPrsWithChangesRequested, getConflictingPrs, getMergeReadyPrs } from './github-sync.js'

interface StateSnapshot {
  hash: string
  timestamp: number
  issueCount: number
  changesRequestedCount: number
  conflictCount: number
  mergeReadyCount: number
  workerFree: boolean
}

let previousSnapshot: StateSnapshot | null = null

export async function hasStateChanged(): Promise<{ changed: boolean; reason: string; snapshot: StateSnapshot }> {
  const config = loadConfig()
  const username = config.github.username

  // Query current state
  const issues = await getOpenIssues(username)
  const changesRequested = await getPrsWithChangesRequested(username)
  const conflicts = await getConflictingPrs(username)
  const mergeReady = await getMergeReadyPrs(username)
  const workerFree = isWorkerSlotFree()

  // Build fingerprint from meaningful fields
  const parts: string[] = []

  // Issue fingerprint: repo#number + labels (sorted for stability)
  for (const i of issues) {
    const raw = Array.isArray(i.labels) ? (i.labels as string[]) : []
    const labels = raw.sort().join(',')
    parts.push(`issue:${i.repo}#${i.number}:${labels}`)
  }

  // PR review fingerprint
  for (const pr of changesRequested) {
    parts.push(`cr:${pr.repo}#${pr.number}:${pr.latestReviewAt?.toISOString() || ''}`)
  }

  // Conflict fingerprint
  for (const pr of conflicts) {
    parts.push(`conflict:${pr.repo}#${pr.number}`)
  }

  // Merge ready fingerprint
  for (const pr of mergeReady) {
    parts.push(`merge:${pr.repo}#${pr.number}`)
  }

  parts.push(`worker:${workerFree}`)

  const hash = createHash('sha256').update(parts.sort().join('|')).digest('hex').slice(0, 16)

  const snapshot: StateSnapshot = {
    hash,
    timestamp: Date.now(),
    issueCount: issues.length,
    changesRequestedCount: changesRequested.length,
    conflictCount: conflicts.length,
    mergeReadyCount: mergeReady.length,
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
  if (snapshot.changesRequestedCount !== previousSnapshot.changesRequestedCount) {
    reasons.push(`changes_requested: ${previousSnapshot.changesRequestedCount} → ${snapshot.changesRequestedCount}`)
  }
  if (snapshot.conflictCount !== previousSnapshot.conflictCount) {
    reasons.push(`conflicts: ${previousSnapshot.conflictCount} → ${snapshot.conflictCount}`)
  }
  if (snapshot.mergeReadyCount !== previousSnapshot.mergeReadyCount) {
    reasons.push(`merge_ready: ${previousSnapshot.mergeReadyCount} → ${snapshot.mergeReadyCount}`)
  }
  if (snapshot.workerFree !== previousSnapshot.workerFree) {
    reasons.push(`worker: ${previousSnapshot.workerFree ? 'free' : 'busy'} → ${snapshot.workerFree ? 'free' : 'busy'}`)
  }
  if (reasons.length === 0) {
    reasons.push('item details changed (labels, reviews, CI)')
  }

  previousSnapshot = snapshot
  return { changed: true, reason: reasons.join(', '), snapshot }
}

/** Force reset — useful after worker completes */
export function resetSnapshot() {
  previousSnapshot = null
}

export type { StateSnapshot }
