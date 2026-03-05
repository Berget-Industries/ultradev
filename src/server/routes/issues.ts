import { Router } from 'express'
import { execFileSync } from 'child_process'

const router = Router()

interface LinkedPr {
  number: number
  url: string
  state: string
  ciStatus: 'passing' | 'failing' | 'pending' | 'none'
  mergeable: boolean
  reviewDecision: string | null
}

interface OpenIssue {
  repo: string
  number: number
  title: string
  labels: string[]
  linkedPr: LinkedPr | null
  status: 'no_pr' | 'ci_pending' | 'ci_failing' | 'changes_requested' | 'ready_to_merge' | 'merged'
}

// Simple cache
let cachedResult: OpenIssue[] | null = null
let cachedAt = 0
const CACHE_TTL = 60_000 // 60 seconds

function gh(...args: string[]): string {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, GH_PAGER: '' },
    }).trim()
  } catch {
    return ''
  }
}

function deriveCiStatus(statusCheckRollup: any[] | null): 'passing' | 'failing' | 'pending' | 'none' {
  // Filter out ghost entries with no name/status/conclusion
  const checks = (statusCheckRollup || []).filter(
    (c: any) => c.name || c.context || c.status || c.conclusion
  )
  if (checks.length === 0) return 'none'
  const hasFailure = checks.some(
    (c: any) => c.conclusion === 'FAILURE' || c.conclusion === 'failure' ||
                 c.conclusion === 'TIMED_OUT' || c.conclusion === 'timed_out'
  )
  if (hasFailure) return 'failing'
  const hasPending = checks.some(
    (c: any) => c.status === 'IN_PROGRESS' || c.status === 'QUEUED' || c.status === 'PENDING' ||
                 c.status === 'in_progress' || c.status === 'queued' || c.status === 'pending'
  )
  if (hasPending) return 'pending'
  return 'passing'
}

function deriveStatus(pr: LinkedPr | null): OpenIssue['status'] {
  if (!pr) return 'no_pr'
  if (pr.state === 'MERGED' || pr.state === 'merged') return 'merged'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes_requested'
  if (pr.ciStatus === 'failing') return 'ci_failing'
  if (pr.ciStatus === 'pending') return 'ci_pending'
  if (pr.ciStatus === 'passing' && pr.mergeable && pr.reviewDecision !== 'CHANGES_REQUESTED') return 'ready_to_merge'
  return 'no_pr'
}

async function fetchIssues(): Promise<OpenIssue[]> {
  // 1. Get all open issues assigned to bergetUltraDev
  const issuesRaw = gh(
    'search', 'issues',
    '--assignee', 'bergetUltraDev',
    '--state', 'open',
    '--json', 'repository,number,title,labels',
    '--limit', '50'
  )
  if (!issuesRaw) return []

  let issues: any[]
  try {
    issues = JSON.parse(issuesRaw)
  } catch {
    return []
  }

  const results: OpenIssue[] = []

  for (const issue of issues) {
    const repo: string = issue.repository?.nameWithOwner || issue.repository?.name || ''
    if (!repo) continue

    const labels: string[] = (issue.labels || []).map((l: any) => l.name || l)

    // 2. Check for linked PR via branch naming convention
    const repoParts = repo.split('/')
    const safeKey = `${repoParts[0]}_${repoParts[1]}_${issue.number}`
    const branchHead = `ultradev/${safeKey}`

    let linkedPr: LinkedPr | null = null

    const prRaw = gh(
      'pr', 'list',
      '--repo', repo,
      '--head', branchHead,
      '--json', 'number,url,state,statusCheckRollup,mergeable,reviewDecision',
      '--limit', '1'
    )

    if (prRaw) {
      try {
        const prs = JSON.parse(prRaw)
        if (prs.length > 0) {
          const pr = prs[0]
          const ciStatus = deriveCiStatus(pr.statusCheckRollup || null)
          linkedPr = {
            number: pr.number,
            url: pr.url,
            state: pr.state,
            ciStatus,
            mergeable: pr.mergeable === 'MERGEABLE' || pr.mergeable === true,
            reviewDecision: pr.reviewDecision || null,
          }
        }
      } catch { /* ignore parse errors */ }
    }

    const status = deriveStatus(linkedPr)

    // Filter out merged
    if (status === 'merged') continue

    results.push({
      repo,
      number: issue.number,
      title: issue.title,
      labels,
      linkedPr,
      status,
    })
  }

  // Sort: ready_to_merge first, then changes_requested, ci_failing, ci_pending, no_pr
  const statusOrder: Record<string, number> = {
    ready_to_merge: 0,
    changes_requested: 1,
    ci_failing: 2,
    ci_pending: 3,
    no_pr: 4,
  }
  results.sort((a, b) => (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5))

  return results
}

router.get('/', async (_req, res) => {
  try {
    const now = Date.now()
    if (cachedResult && now - cachedAt < CACHE_TTL) {
      return res.json(cachedResult)
    }

    const issues = await fetchIssues()
    cachedResult = issues
    cachedAt = Date.now()
    res.json(issues)
  } catch (err: any) {
    console.error('[issues] Error fetching issues:', err)
    res.status(500).json({ error: err.message || 'Failed to fetch issues' })
  }
})

export default router
