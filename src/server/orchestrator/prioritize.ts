import { getIssueState, type IssueState } from './state.js'

// ---------------------------------------------------------------------------
// Label keyword tiers — highest matching tier wins (not additive)
// RegExp tested against each label name (case-insensitive)
// ---------------------------------------------------------------------------
const LABEL_TIERS: [RegExp, number][] = [
  [/critical|urgent|hotfix|p0|severity.*critical|blocker/i, 40],
  [/bug|defect|regression|broken/i, 30],
  [/important|p1|security|vulnerability/i, 20],
  [/feature|enhancement|improvement/i, 10],
  [/chore|docs|documentation|refactor|cleanup|tech.?debt/i, 0],
]

// ---------------------------------------------------------------------------
// Scoring weights (easy to tune)
// ---------------------------------------------------------------------------
const MAX_LABEL_SCORE = 40
const MAX_FRESHNESS_SCORE = 20
const MAX_AGE_SCORE = 15
const MAX_PARTIAL_PROGRESS_SCORE = 15
const RETRY_NO_PROGRESS_PENALTY = -10
const MAX_COMMENT_SCORE = 10

const FRESHNESS_WINDOW_MS = 60 * 60 * 1000       // 1 hour — "just assigned"
const AGE_RAMP_START_MS = 3 * 24 * 60 * 60 * 1000 // 3 days — start boosting old issues
const AGE_RAMP_CAP_MS = 14 * 24 * 60 * 60 * 1000  // 14 days — max age boost

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ScoreBreakdown {
  label: number
  freshness: number
  age: number
  progress: number
  comments: number
  total: number
}

export interface ScoredIssue {
  issue: any
  score: ScoreBreakdown
}

// ---------------------------------------------------------------------------
// Score a single issue
// ---------------------------------------------------------------------------
export function scoreIssue(issue: any, state: IssueState | null): ScoreBreakdown {
  const labels: string[] = (issue.labels || []).map((l: any) =>
    typeof l === 'string' ? l : l.name || ''
  )

  // --- Label score: highest matching tier ---
  let label = 0
  for (const name of labels) {
    for (const [re, points] of LABEL_TIERS) {
      if (re.test(name) && points > label) {
        label = points
      }
    }
  }

  // --- Freshness: recently created issues get a boost ---
  let freshness = 0
  const createdAt = issue.createdAt ? new Date(issue.createdAt).getTime() : 0
  if (createdAt > 0) {
    const ageMs = Date.now() - createdAt
    if (ageMs < FRESHNESS_WINDOW_MS) {
      // Linear ramp: full score at 0 min, 0 at FRESHNESS_WINDOW
      freshness = Math.round(MAX_FRESHNESS_SCORE * (1 - ageMs / FRESHNESS_WINDOW_MS))
    }
  }

  // --- Age: old issues shouldn't rot ---
  let age = 0
  if (createdAt > 0) {
    const ageMs = Date.now() - createdAt
    if (ageMs > AGE_RAMP_START_MS) {
      const overage = Math.min(ageMs - AGE_RAMP_START_MS, AGE_RAMP_CAP_MS - AGE_RAMP_START_MS)
      const ratio = overage / (AGE_RAMP_CAP_MS - AGE_RAMP_START_MS)
      age = Math.round(MAX_AGE_SCORE * ratio)
    }
  }

  // --- Partial progress: almost done = finish it ---
  let progress = 0
  if (state?.madeProgress) {
    progress = MAX_PARTIAL_PROGRESS_SCORE
  } else if (state?.status === 'failed' && (state.attempts || 0) > 0) {
    progress = RETRY_NO_PROGRESS_PENALTY
  }

  // --- Comment count: more discussion = more urgency ---
  let comments = 0
  const commentCount = issue.comments?.totalCount ?? issue.comments ?? 0
  if (typeof commentCount === 'number' && commentCount > 0) {
    // 1 comment = 3pts, 2 = 5pts, 5+ = 10pts (log curve)
    comments = Math.min(MAX_COMMENT_SCORE, Math.round(MAX_COMMENT_SCORE * Math.log2(commentCount + 1) / Math.log2(6)))
  }

  const total = label + freshness + age + progress + comments

  return { label, freshness, age, progress, comments, total }
}

// ---------------------------------------------------------------------------
// Sort a list of issues by priority score (highest first)
// ---------------------------------------------------------------------------
export function prioritizeIssues(issues: any[]): ScoredIssue[] {
  const scored: ScoredIssue[] = issues.map(issue => {
    const repo = issue.repository?.nameWithOwner || ''
    const key = `${repo}#${issue.number}`
    const state = getIssueState(key)
    return { issue, score: scoreIssue(issue, state) }
  })

  scored.sort((a, b) => b.score.total - a.score.total)
  return scored
}

// ---------------------------------------------------------------------------
// Format score for logging
// ---------------------------------------------------------------------------
export function formatScore(key: string, s: ScoreBreakdown): string {
  const parts: string[] = []
  if (s.label) parts.push(`label:+${s.label}`)
  if (s.freshness) parts.push(`fresh:+${s.freshness}`)
  if (s.age) parts.push(`age:+${s.age}`)
  if (s.progress > 0) parts.push(`progress:+${s.progress}`)
  if (s.progress < 0) parts.push(`progress:${s.progress}`)
  if (s.comments) parts.push(`comments:+${s.comments}`)
  return `${key} → ${s.total}pts (${parts.join(', ') || 'no signals'})`
}
