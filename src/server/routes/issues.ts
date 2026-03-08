import { Router } from 'express'
import { cached } from '../cache.js'
import { loadConfig } from '../orchestrator/config.js'
import { getOpenIssues, getPrsByRepos, type DbPr } from '../orchestrator/github-sync.js'
import { scoreIssue } from '../orchestrator/prioritize.js'
import { getIssueState } from '../orchestrator/state.js'

const router = Router()

interface LinkedPr {
  number: number
  url: string
  state: string
  ciStatus: 'passing' | 'failing' | 'pending' | 'none'
  mergeable: boolean
  mergeableState: string | null
  reviewDecision: string | null
}

interface OpenIssue {
  repo: string
  number: number
  title: string
  labels: string[]
  linkedPrs: LinkedPr[]
  status: 'no_pr' | 'ci_pending' | 'ci_failing' | 'changes_requested' | 'has_conflicts' | 'ready_to_merge' | 'merged'
  priority: number
}

function toLinkedPr(pr: DbPr): LinkedPr {
  return {
    number: pr.number,
    url: `https://github.com/${pr.repo}/pull/${pr.number}`,
    state: pr.state,
    ciStatus: pr.ci_status as LinkedPr['ciStatus'],
    mergeable: pr.mergeable === 'MERGEABLE',
    mergeableState: pr.mergeable || null,
    reviewDecision: pr.review_decision || null,
  }
}

/** Derive overall issue status from all linked PRs. Looks at the latest open PR first. */
function deriveStatus(prs: LinkedPr[]): OpenIssue['status'] {
  if (prs.length === 0) return 'no_pr'
  if (prs.every(pr => pr.state === 'MERGED' || pr.state === 'merged')) return 'merged'

  const openPrs = prs.filter(pr => pr.state === 'OPEN' || pr.state === 'open')
  if (openPrs.length === 0) return 'no_pr'

  const latest = openPrs[openPrs.length - 1]
  if (latest.reviewDecision === 'CHANGES_REQUESTED') return 'changes_requested'
  if (latest.mergeableState === 'CONFLICTING') return 'has_conflicts'
  if (latest.ciStatus === 'failing') return 'ci_failing'
  if (latest.ciStatus === 'pending') return 'ci_pending'
  if (latest.ciStatus === 'passing' && latest.mergeable && latest.reviewDecision !== 'CHANGES_REQUESTED') return 'ready_to_merge'
  return 'no_pr'
}

async function fetchIssues(): Promise<OpenIssue[]> {
  const config = loadConfig()
  const username = config.github.username

  // Read from DB (populated by github-sync)
  const issues = await getOpenIssues(username)
  if (issues.length === 0) return []

  const repos = [...new Set(issues.map(i => i.repo))]
  const allPrs = await getPrsByRepos(username, repos)

  // Build issue→PRs map from linked_issue_numbers
  const prMap = new Map<string, LinkedPr[]>()
  for (const pr of allPrs) {
    const linkedNums: number[] = pr.linked_issue_numbers || []
    for (const issueNum of linkedNums) {
      const key = `${pr.repo}#${issueNum}`
      const existing = prMap.get(key) || []
      existing.push(toLinkedPr(pr))
      prMap.set(key, existing)
    }
  }

  const results: OpenIssue[] = []

  for (const issue of issues) {
    const labels: string[] = Array.isArray(issue.labels) ? issue.labels : []
    const key = `${issue.repo}#${issue.number}`
    const linkedPrs = prMap.get(key) || []
    linkedPrs.sort((a, b) => a.number - b.number)

    const status = deriveStatus(linkedPrs)
    if (status === 'merged') continue

    const state = getIssueState(key)
    const score = scoreIssue({ labels, createdAt: issue.created_at }, state)

    results.push({
      repo: issue.repo,
      number: issue.number,
      title: issue.title,
      labels,
      linkedPrs,
      status,
      priority: score.total,
    })
  }

  results.sort((a, b) => b.priority - a.priority)

  return results
}

router.get('/', async (_req, res) => {
  try {
    // Short TTL since data is already in DB — just avoiding concurrent computation
    const issues = await cached<OpenIssue[]>('issues:open', 10, fetchIssues)
    res.json(issues)
  } catch (err: any) {
    console.error('[issues] Error fetching issues:', err)
    res.status(500).json({ error: err.message || 'Failed to fetch issues' })
  }
})

export default router
