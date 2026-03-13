import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Config } from './config.js'
import { getIssueState } from './state.js'

const execFileAsync = promisify(execFile)
import { scoreIssue, formatScore } from './prioritize.js'
import { logActivity } from './activity-log.js'
import type { GithubIssue, GithubPr } from '@prisma/client'

// Types for the plate (everything UltraDev could work on)
export interface PlateItem {
  type: 'issue' | 'pr_review' | 'conflict' | 'auto_merge'
  repo: string
  number: number
  title: string
  details: string // human-readable summary
}

export interface Plate {
  items: PlateItem[]
  currentTime: string
}

export interface DispatchDecision {
  action: 'handle_issue' | 'handle_pr_review' | 'handle_conflict' | 'auto_merge' | 'skip'
  repo: string
  number: number
  reasoning: string
}

// Build the plate summary from DB state
export function buildPlate(
  issues: GithubIssue[],
  changesRequestedPrs: GithubPr[],
  conflictingPrs: GithubPr[],
  mergeReadyPrs: GithubPr[],
): Plate {
  const items: PlateItem[] = []

  for (const pr of changesRequestedPrs) {
    const key = `pr:${pr.repo}#${pr.number}`
    const state = getIssueState(key)
    const attempts = state?.attempts || 0
    items.push({
      type: 'pr_review',
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      details: `Review feedback needs addressing. Attempts: ${attempts}. Latest review: ${pr.latestReviewAt?.toISOString() || 'unknown'}. CI: ${pr.ciStatus}.`,
    })
  }

  for (const pr of conflictingPrs) {
    const key = `conflict:${pr.repo}#${pr.number}`
    const state = getIssueState(key)
    const attempts = state?.attempts || 0
    items.push({
      type: 'conflict',
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      details: `Merge conflict on branch ${pr.headRef} → ${pr.baseRef}. Attempts: ${attempts}.`,
    })
  }

  for (const issue of issues) {
    const key = `${issue.repo}#${issue.number}`
    const state = getIssueState(key)
    const labels = Array.isArray(issue.labels) ? (issue.labels as string[]) : []
    const score = scoreIssue({ labels, createdAt: issue.createdAt?.toISOString() }, state)
    const attempts = state?.attempts || 0
    const madeProgress = state?.madeProgress ? ' (made progress last attempt)' : ''

    items.push({
      type: 'issue',
      repo: issue.repo,
      number: issue.number,
      title: issue.title,
      details: `Labels: [${labels.join(', ')}]. Priority score: ${score.total} (${formatScore(key, score)}). Attempts: ${attempts}${madeProgress}. Created: ${issue.createdAt?.toISOString() || 'unknown'}.`,
    })
  }

  for (const pr of mergeReadyPrs) {
    items.push({
      type: 'auto_merge',
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      details: `CI passing, approved, mergeable. Ready to squash-merge.`,
    })
  }

  return {
    items,
    currentTime: new Date().toISOString(),
  }
}

// Call Claude to make the dispatch decision
export async function intelligentDispatch(plate: Plate, config: Config): Promise<DispatchDecision> {
  if (plate.items.length === 0) {
    return { action: 'skip', repo: '', number: 0, reasoning: 'Nothing actionable on the plate.' }
  }

  // If only one item, no need to call Claude
  if (plate.items.length === 1) {
    const item = plate.items[0]
    const actionMap: Record<PlateItem['type'], DispatchDecision['action']> = {
      'issue': 'handle_issue',
      'pr_review': 'handle_pr_review',
      'conflict': 'handle_conflict',
      'auto_merge': 'auto_merge',
    }
    return {
      action: actionMap[item.type],
      repo: item.repo,
      number: item.number,
      reasoning: 'Only one actionable item.',
    }
  }

  const prompt = buildDispatchPrompt(plate)

  try {
    const { stdout } = await execFileAsync(config.claude.command, [
      '--print',
      '--max-turns', '1',
      '--output-format', 'json',
      prompt,
    ], {
      encoding: 'utf-8',
      timeout: 30_000, // 30s max for a dispatch decision
      env: { ...process.env },
    })

    const parsed = JSON.parse(stdout.trim())
    // Claude with --output-format json wraps the response — extract the text content
    const text = typeof parsed === 'string' ? parsed :
      parsed.result || parsed.content || parsed.text ||
      (Array.isArray(parsed) ? parsed.find((b: any) => b.type === 'text')?.text : null) ||
      JSON.stringify(parsed)

    const decision = parseDecision(text, plate)
    logActivity('intelligent-dispatch', `Decision: ${decision.action} ${decision.repo}#${decision.number} — ${decision.reasoning}`)
    return decision
  } catch (err: any) {
    console.error('[intelligent-dispatch] Claude call failed, will use fallback:', err.message)
    logActivity('intelligent-dispatch', `Claude call failed: ${err.message} — using fallback`)
    return fallbackDispatch(plate)
  }
}

function buildDispatchPrompt(plate: Plate): string {
  const itemList = plate.items.map((item, i) =>
    `${i + 1}. [${item.type}] ${item.repo}#${item.number}: ${item.title}\n   ${item.details}`
  ).join('\n\n')

  return `You are UltraDev's dispatch brain. You decide what to work on next.

## Current plate (${plate.items.length} items):

${itemList}

## Guidelines (not strict rules — use your judgment):
- PR review feedback is usually urgent — reviewers are waiting
- Merge conflicts block progress on existing work
- Issues with partial progress should often be finished before starting new ones
- Auto-merging approved PRs is quick and clears the queue
- Consider the overall state: if there are many open PRs, maybe focus on getting them merged rather than creating more
- Higher priority scores on issues generally mean more urgent work
- Items with many failed attempts might need a different approach or should be deprioritized

## Your decision

Pick ONE item to work on next. Respond with ONLY a JSON object (no markdown, no explanation outside the JSON):

{"action": "handle_issue" | "handle_pr_review" | "handle_conflict" | "auto_merge" | "skip", "repo": "owner/repo", "number": 123, "reasoning": "brief explanation"}`
}

const VALID_ACTIONS: DispatchDecision['action'][] = ['handle_issue', 'handle_pr_review', 'handle_conflict', 'auto_merge', 'skip']

function parseDecision(text: string, plate: Plate): DispatchDecision {
  // Try to extract JSON from the response (match first complete JSON object without nested braces)
  const jsonMatch = text.match(/\{[^{}]*"action"[^{}]*\}/)
  if (jsonMatch) {
    try {
      const decision = JSON.parse(jsonMatch[0]) as DispatchDecision
      // Validate action is a known enum value
      if (!VALID_ACTIONS.includes(decision.action)) {
        console.warn(`[intelligent-dispatch] Invalid action: ${decision.action}`)
        return fallbackDispatch(plate)
      }
      // Validate the decision references a real plate item (skip doesn't need validation)
      if (decision.action !== 'skip') {
        const valid = plate.items.some(
          item => item.repo === decision.repo && item.number === decision.number
        )
        if (!valid) {
          console.warn(`[intelligent-dispatch] Decision references unknown item: ${decision.repo}#${decision.number}`)
          return fallbackDispatch(plate)
        }
      }
      if (decision.reasoning) {
        return decision
      }
    } catch { /* fall through to fallback */ }
  }

  console.warn('[intelligent-dispatch] Could not parse Claude response, using fallback')
  return fallbackDispatch(plate)
}

// Fallback: use the old priority order if Claude fails
function fallbackDispatch(plate: Plate): DispatchDecision {
  const priorityOrder: PlateItem['type'][] = ['pr_review', 'conflict', 'issue', 'auto_merge']

  for (const type of priorityOrder) {
    const item = plate.items.find(i => i.type === type)
    if (item) {
      const actionMap: Record<PlateItem['type'], DispatchDecision['action']> = {
        'issue': 'handle_issue',
        'pr_review': 'handle_pr_review',
        'conflict': 'handle_conflict',
        'auto_merge': 'auto_merge',
      }
      return {
        action: actionMap[item.type],
        repo: item.repo,
        number: item.number,
        reasoning: 'Fallback: using static priority order (Claude call failed).',
      }
    }
  }

  return { action: 'skip', repo: '', number: 0, reasoning: 'No actionable items.' }
}
