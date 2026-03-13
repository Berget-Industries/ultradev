import { spawn } from 'child_process'
import type { Config } from './config.js'
import { getIssueState } from './state.js'
import { logActivity } from './activity-log.js'
import type { GithubIssue, GithubPr } from '@prisma/client'

// Types for the plate (everything UltraDev could work on)
export interface PlateItem {
  type: 'issue' | 'pr_review' | 'conflict' | 'auto_merge' | 'pr_open'
  repo: string
  number: number
  title: string
  status: 'pending' | 'done' | 'in_progress' | 'failed'
  attempts: number
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
    const status = (state?.status || 'pending') as PlateItem['status']
    const attempts = state?.attempts || 0
    const error = state?.error ? ` Last error: ${state.error}` : ''

    items.push({
      type: 'issue',
      repo: issue.repo,
      number: issue.number,
      title: issue.title,
      status,
      attempts,
      details: `Labels: [${labels.join(', ')}]. Status: ${status}. Attempts: ${attempts}.${error} Created: ${issue.createdAt?.toISOString() || 'unknown'}.`,
    })
  }

  // --- PRs ---
  for (const pr of prs) {
    // Determine PR type — only add truly actionable PRs
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
    } else if (pr.ciStatus === 'failing') {
      type = 'pr_review' // CI failures need attention
    } else {
      // No actionable signal — open PR with no review feedback, no conflicts, no CI failures
      type = 'pr_open'
    }

    // Use the correct state key matching what dispatch writes:
    // conflict: -> conflict:repo#number, auto_merge: -> merge:repo#number, else -> pr:repo#number
    const stateKey = type === 'conflict'
      ? `conflict:${pr.repo}#${pr.number}`
      : type === 'auto_merge'
        ? `merge:${pr.repo}#${pr.number}`
        : `pr:${pr.repo}#${pr.number}`
    const state = getIssueState(stateKey)
    const rawStatus = state?.status || 'pending'
    const attempts = state?.attempts || 0
    const error = state?.error ? ` Last error: ${state.error}` : ''
    // Always read lastReviewAt from the pr: key since that's where review feedback is tracked
    const reviewState = type !== 'pr_review' ? getIssueState(`pr:${pr.repo}#${pr.number}`) : state
    const lastReviewAt = reviewState?.lastReviewAt || null

    // Re-open done PRs that have new feedback since we last addressed them
    const hasNewFeedback =
      !!pr.latestReviewAt &&
      (!lastReviewAt || pr.latestReviewAt.getTime() > new Date(lastReviewAt).getTime())
    const status = (rawStatus === 'done' && hasNewFeedback ? 'pending' : rawStatus) as PlateItem['status']

    const latestReviewIso = pr.latestReviewAt?.toISOString() || 'none'
    const lastAddressedIso = lastReviewAt || 'never'
    const prUpdatedAtIso = pr.updatedAt?.toISOString() || 'unknown'

    items.push({
      type,
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      status,
      attempts,
      details: `Review: ${pr.reviewDecision || 'none'}. CI: ${pr.ciStatus}. Mergeable: ${pr.mergeable}. Latest review: ${latestReviewIso}. Last addressed: ${lastAddressedIso}. PR updatedAt: ${prUpdatedAtIso}. Status: ${status}. Attempts: ${attempts}.${error}`,
    })
  }

  return {
    items,
    currentTime: new Date().toISOString(),
  }
}

/** Spawn claude and pipe the prompt via stdin (avoids shell argument length limits) */
function runClaudeWithStdin(command: string, args: string[], input: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Timed out after ${timeout}ms`))
    }, timeout)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`Exit code ${code}: ${stderr.slice(0, 500)}`))
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    child.stdin.write(input)
    child.stdin.end()
  })
}

// Call Claude to make the dispatch decision
export async function intelligentDispatch(plate: Plate, config: Config): Promise<DispatchDecision> {
  if (plate.items.length === 0) {
    return { action: 'skip', repo: '', number: 0, reasoning: 'Nothing actionable on the plate.' }
  }

  // Filter out items that are done, in_progress, or non-actionable (pr_open)
  const actionableItems = plate.items.filter(i =>
    i.status !== 'done' && i.status !== 'in_progress' && i.type !== 'pr_open'
  )

  if (actionableItems.length === 0) {
    return { action: 'skip', repo: '', number: 0, reasoning: 'All items are done, in_progress, or have no actionable signal.' }
  }

  // --- ONE-AT-A-TIME RULE ---
  // If there are any open PRs that are NOT yet merged (pr_review, conflict, auto_merge, pr_open),
  // do NOT start new issues. Focus on getting existing PRs through the review→merge lifecycle.
  const hasOpenPrs = plate.items.some(i =>
    (i.type === 'pr_review' || i.type === 'conflict' || i.type === 'auto_merge' || i.type === 'pr_open') &&
    i.status !== 'done'
  )
  const filteredItems = hasOpenPrs
    ? actionableItems.filter(i => i.type !== 'issue')
    : actionableItems

  if (filteredItems.length === 0) {
    return { action: 'skip', repo: '', number: 0, reasoning: 'Open PRs exist — finish PR lifecycle before starting new issues.' }
  }

  // If only one actionable item, no need to call Claude
  if (filteredItems.length === 1) {
    const item = filteredItems[0]
    const actionMap: Record<PlateItem['type'], DispatchDecision['action']> = {
      'issue': 'handle_issue',
      'pr_review': 'handle_pr_review',
      'conflict': 'handle_conflict',
      'auto_merge': 'auto_merge',
      'pr_open': 'skip',
    }
    return {
      action: actionMap[item.type],
      repo: item.repo,
      number: item.number,
      reasoning: hasOpenPrs ? 'Only one actionable PR item (issues blocked by open PRs).' : 'Only one actionable item.',
    }
  }

  const actionablePlate: Plate = { ...plate, items: filteredItems }
  const prompt = buildDispatchPrompt(actionablePlate)

  try {
    const text = await runClaudeWithStdin(config.claude.command, [
      '--print',
      '--max-turns', '1',
      '--model', 'haiku',
    ], prompt, 30_000)

    const decision = parseDecision(text, actionablePlate)
    logActivity('intelligent-dispatch', `Decision: ${decision.action} ${decision.repo}#${decision.number} — ${decision.reasoning}`)
    return decision
  } catch (err: any) {
    console.error('[intelligent-dispatch] Claude call failed, will use fallback:', err.message)
    logActivity('intelligent-dispatch', `Claude call failed: ${err.message} — using fallback`)
    return fallbackDispatch(actionablePlate)
  }
}

function buildDispatchPrompt(plate: Plate): string {
  const itemList = plate.items.map((item, i) =>
    `${i + 1}. [${item.type}] ${item.repo}#${item.number}: ${item.title}\n   ${item.details}`
  ).join('\n\n')

  return `You are UltraDev's dispatch brain. Below are ALL open issues and PRs across all repos. Each has a state (pending/done/failed/in_progress) and an attempt count from previous work cycles. Your job: pick ONE item to work on, or skip if nothing is actionable.

## Current plate (${plate.items.length} items, time: ${plate.currentTime}):

${itemList}

## CRITICAL RULE: One issue at a time
- NEVER start a new issue if any open PR exists (review pending, conflicts, CI failing, or auto-mergeable).
- The full lifecycle is: issue → branch → code → push → PR → CI green → CodeRabbit review → address feedback → merge → THEN next issue.
- If there are open PRs on the plate, ONLY pick PR-related actions (handle_pr_review, handle_conflict, auto_merge).
- Only pick handle_issue when there are ZERO open PRs.

## Decision guidelines:
- status='done' with no new activity since last addressed → SKIP (already handled)
- status='done' but "Latest review" timestamp > "Last addressed" timestamp → NEW FEEDBACK arrived, should iterate on the PR
- status='in_progress' → SKIP (a worker is already on it)
- status='failed' → may be worth retrying if attempts < 3
- PR reviews (especially from human reviewers requesting changes) are urgent — reviewers are waiting
- Merge conflicts block progress on existing work — resolve them
- Auto-mergeable PRs (type=auto_merge) are quick wins — merge them to clear the queue
- Items with many failed attempts (3+) should be deprioritized — they may need human intervention
- New issues (status='pending', attempts=0) are ONLY fair game if there are no open PRs

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
      if (typeof decision.reasoning === 'string') {
        return decision
      }
      console.warn('[intelligent-dispatch] Decision missing reasoning field')
    } catch { /* fall through to fallback */ }
  }

  console.warn('[intelligent-dispatch] Could not parse Claude response, using fallback')
  return fallbackDispatch(plate)
}

// Fallback: use the old priority order if Claude fails
// Respects one-at-a-time: auto_merge > pr_review > conflict first, then issues only if no PRs
function fallbackDispatch(plate: Plate): DispatchDecision {
  const hasOpenPrs = plate.items.some(i =>
    (i.type === 'pr_review' || i.type === 'conflict' || i.type === 'auto_merge' || i.type === 'pr_open') &&
    i.status !== 'done'
  )
  const priorityOrder: PlateItem['type'][] = hasOpenPrs
    ? ['auto_merge', 'pr_review', 'conflict']
    : ['auto_merge', 'pr_review', 'conflict', 'issue']

  for (const type of priorityOrder) {
    const item = plate.items.find(i => i.type === type)
    if (item) {
      const actionMap: Record<PlateItem['type'], DispatchDecision['action']> = {
        'issue': 'handle_issue',
        'pr_review': 'handle_pr_review',
        'conflict': 'handle_conflict',
        'auto_merge': 'auto_merge',
        'pr_open': 'skip',
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
