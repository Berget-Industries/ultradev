import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Config } from './config.js'
import { getIssueState } from './state.js'

const execFileAsync = promisify(execFile)
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

/**
 * Unified plate builder — receives ALL open issues and PRs (already filtered by isRepoAllowed).
 * Claude's intelligent dispatch sees everything and decides what to work on, including
 * items that are done, in_progress, or at max retries — it can make informed decisions.
 */
export function buildUnifiedPlate(issues: GithubIssue[], prs: GithubPr[]): Plate {
  const items: PlateItem[] = []

  // --- Issues ---
  for (const issue of issues) {
    const key = `${issue.repo}#${issue.number}`
    const state = getIssueState(key)
    const labels = Array.isArray(issue.labels) ? (issue.labels as string[]) : []
    const status = state?.status || 'pending'
    const attempts = state?.attempts || 0
    const error = state?.error ? ` Last error: ${state.error}` : ''

    items.push({
      type: 'issue',
      repo: issue.repo,
      number: issue.number,
      title: issue.title,
      details: `Labels: [${labels.join(', ')}]. Status: ${status}. Attempts: ${attempts}.${error} Created: ${issue.createdAt?.toISOString() || 'unknown'}.`,
    })
  }

  // --- PRs ---
  for (const pr of prs) {
    const key = `pr:${pr.repo}#${pr.number}`
    const state = getIssueState(key)
    const status = state?.status || 'pending'
    const attempts = state?.attempts || 0
    const error = state?.error ? ` Last error: ${state.error}` : ''
    const lastReviewAt = state?.lastReviewAt || null

    // Determine PR type
    let type: PlateItem['type']
    if (pr.reviewDecision === 'APPROVED' && pr.ciStatus === 'passing' && pr.mergeable === 'MERGEABLE') {
      type = 'auto_merge'
    } else if (pr.mergeable === 'CONFLICTING') {
      type = 'conflict'
    } else if (
      pr.reviewDecision === 'CHANGES_REQUESTED' ||
      (pr.reviewDecision === 'REVIEW_REQUIRED' && pr.latestReviewAt != null)
    ) {
      type = 'pr_review'
    } else {
      type = 'pr_review' // generic PR needing attention
    }

    const latestReviewIso = pr.latestReviewAt?.toISOString() || 'none'
    const lastAddressedIso = lastReviewAt || 'never'

    items.push({
      type,
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      details: `Review: ${pr.reviewDecision || 'none'}. CI: ${pr.ciStatus}. Mergeable: ${pr.mergeable}. Latest review: ${latestReviewIso}. Last addressed: ${lastAddressedIso}. Status: ${status}. Attempts: ${attempts}.${error}`,
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

  return `You are UltraDev's dispatch brain. Below are ALL open issues and PRs across all repos. Each has a state (pending/done/failed/in_progress) and an attempt count from previous work cycles. Your job: pick ONE item to work on, or skip if nothing is actionable.

## Current plate (${plate.items.length} items, time: ${plate.currentTime}):

${itemList}

## Decision guidelines:
- status='done' with no new activity since last addressed → SKIP (already handled)
- status='done' but "Latest review" timestamp > "Last addressed" timestamp → NEW FEEDBACK arrived, should iterate on the PR
- status='in_progress' → SKIP (a worker is already on it)
- status='failed' → may be worth retrying if attempts < 3
- PR reviews (especially from human reviewers requesting changes) are urgent — reviewers are waiting
- Merge conflicts block progress on existing work — resolve them
- Auto-mergeable PRs (type=auto_merge) are quick wins — merge them to clear the queue
- Items with many failed attempts (3+) should be deprioritized — they may need human intervention
- Consider the big picture: many open PRs → focus on getting them merged rather than creating more
- New issues (status='pending', attempts=0) are fair game

## Response format

Respond with ONLY a JSON object (no markdown, no explanation outside the JSON):

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
