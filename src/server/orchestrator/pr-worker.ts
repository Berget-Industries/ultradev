import { spawn, execFileSync } from 'child_process'
import { mkdirSync, existsSync, appendFileSync } from 'fs'
import { join } from 'path'
import type { Config } from './config.js'
import type { WorkerResult } from './worker.js'
import { handleRateLimitEvent } from './rate-limit.js'
import { getPromptTemplate } from './prompt-loader.js'
import { renderTemplate } from '../lib/template.js'

interface PrDetail {
  number: number
  title: string
  body?: string
  headRefName: string
  baseRefName: string
  url?: string
}

interface Review {
  state: string
  body?: string
  author?: { login: string }
}

interface ReviewComment {
  body: string
  path: string
  line?: number
  author: string
}

export async function spawnPrWorker(
  repo: string,
  pr: PrDetail,
  reviews: Review[],
  reviewComments: ReviewComment[],
  config: Config,
  logFile?: string,
  timeoutMs?: number,
): Promise<WorkerResult> {
  const repoBase = join(config.paths.repos, repo)

  ensureRepo(repo, repoBase)

  const prBranch = pr.headRefName

  // Check out the PR branch directly — we push fixes to the same branch
  try {
    execFileSync('git', ['fetch', 'origin', prBranch], { cwd: repoBase, timeout: 30000 })
    execFileSync('git', ['checkout', prBranch], { cwd: repoBase, timeout: 10000 })
    execFileSync('git', ['reset', '--hard', `origin/${prBranch}`], { cwd: repoBase, timeout: 10000 })
  } catch (err: any) {
    return { success: false, error: `Branch setup failed: ${err.message}`, partial: false, logFile: '' }
  }

  const prompt = await buildPrPrompt(repo, pr, prBranch, reviews, reviewComments)

  if (!logFile) logFile = join(config.paths.logs, `pr_${pr.number}-fix-${Date.now()}.log`)
  mkdirSync(config.paths.logs, { recursive: true })

  return new Promise((resolve) => {
    const args = [...config.claude.flags, '--print', '--output-format', 'stream-json', prompt]

    console.log(`[pr-worker] Spawning claude in ${repoBase} on branch ${prBranch}`)

    const child = spawn(config.claude.command, args, {
      cwd: repoBase,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: timeoutMs || 30 * 60 * 1000,
    })

    let output = ''
    let lineBuf = ''

    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString()
      output += chunk
      appendFileSync(logFile, data)

      // Parse stream-json lines for rate limit events
      lineBuf += chunk
      const lines = lineBuf.split('\n')
      lineBuf = lines.pop() || ''
      for (const line of lines) {
        try {
          const event = JSON.parse(line.trim())
          if (event.type === 'rate_limit_event' && event.rate_limit_info) {
            handleRateLimitEvent(event.rate_limit_info)
          }
        } catch { /* not json or incomplete */ }
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      appendFileSync(logFile, data)
    })

    child.on('close', (code: number | null) => {
      console.log(`[pr-worker] Claude exited with code ${code}`)

      // Check if commits were pushed
      let pushed = false
      try {
        const local = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoBase, encoding: 'utf-8', timeout: 5000 }).trim()
        const remote = execFileSync('git', ['rev-parse', `origin/${prBranch}`], { cwd: repoBase, encoding: 'utf-8', timeout: 5000 }).trim()
        pushed = local !== remote
      } catch { /* can't tell */ }

      // Reset to default branch
      const defaultBranch = getDefaultBranch(repoBase)
      try {
        execFileSync('git', ['checkout', defaultBranch], { cwd: repoBase, timeout: 10000 })
      } catch { /* ok */ }

      const prUrl = pr.url || `https://github.com/${repo}/pull/${pr.number}`

      if (code === 0 && pushed) {
        resolve({ success: true, prUrl, logFile, partial: false })
      } else if (code === 0) {
        resolve({ success: true, prUrl: null, logFile, partial: false })
      } else {
        resolve({ success: false, error: `Exit code ${code}`, logFile, partial: false })
      }
    })

    child.on('error', (err: Error) => {
      resolve({ success: false, error: err.message, logFile, partial: false })
    })
  })
}

function ensureRepo(repo: string, repoBase: string) {
  if (existsSync(join(repoBase, '.git'))) {
    try {
      execFileSync('git', ['fetch', '--all', '--prune'], { cwd: repoBase, timeout: 30000 })
    } catch { /* ok */ }
  } else {
    mkdirSync(repoBase, { recursive: true })
    execFileSync('gh', ['repo', 'clone', repo, repoBase], { timeout: 120000 })
  }
}

function getDefaultBranch(repoDir: string): string {
  try {
    const ref = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: repoDir, encoding: 'utf-8',
    }).trim()
    return ref.replace('refs/remotes/origin/', '')
  } catch {
    try {
      execFileSync('git', ['rev-parse', '--verify', 'main'], { cwd: repoDir, timeout: 5000 })
      return 'main'
    } catch {
      return 'master'
    }
  }
}

async function buildPrPrompt(
  repo: string,
  pr: PrDetail,
  prBranch: string,
  reviews: Review[],
  reviewComments: ReviewComment[],
): Promise<string> {
  let reviewFeedback = ''
  for (const review of reviews) {
    reviewFeedback += `### ${review.author?.login || 'Reviewer'} (${review.state}):\n${review.body || 'No comment.'}\n\n`
  }

  let inlineComments = ''
  if (reviewComments.length > 0) {
    inlineComments = `### Inline Comments:\n\n`
    for (const c of reviewComments) {
      inlineComments += `- **${c.author}** on \`${c.path}\`${c.line ? ` line ${c.line}` : ''}:\n  ${c.body}\n\n`
    }
  }

  const tmpl = await getPromptTemplate('pr-review')
  if (tmpl) {
    return renderTemplate(tmpl.template, {
      repo,
      pr_number: String(pr.number),
      pr_title: pr.title,
      pr_body: pr.body || 'No description.',
      review_feedback: reviewFeedback,
      inline_comments: inlineComments,
      pr_branch: prBranch,
      base_ref: pr.baseRefName,
    })
  }

  let prompt = `You are addressing review feedback on PR #${pr.number} in ${repo}.

## Original PR: ${pr.title}

${pr.body || 'No description.'}

## Review Feedback

`

  prompt += reviewFeedback

  if (inlineComments) {
    prompt += inlineComments
  }

  prompt += `## Branch Setup

You are on branch \`${prBranch}\`. This is the PR branch.
The PR merges \`${prBranch}\` into \`${pr.baseRefName}\`.

## Instructions

1. Read and understand ALL the review feedback carefully.
2. **Triage each comment:**
   - If a comment is labeled 🧹 Nitpick or 🔵 Trivial: you do NOT need to change code. Instead, reply to the comment with a brief explanation of your reasoning, then resolve the thread.
   - If a comment is a real issue (not a nitpick): fix the code as requested.
3. Explore the relevant code to understand context.
4. Make the requested changes on this branch (\`${prBranch}\`).
5. Run tests if they exist. Use \`pnpm --filter <package> test\` to run tests.
6. Commit your changes with a clear message describing what review feedback you addressed.
7. Push your commits to origin: \`git push origin ${prBranch}\`
8. The existing PR will be updated automatically. Do NOT create a new PR.

## CRITICAL: Close the CodeRabbit review loop

After pushing your changes, you MUST complete ALL of these steps:

9. **Resolve ALL review threads** you addressed:
   For each review comment (both fixed and nitpick-replied):
   \`\`\`
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<thread_id>"}) { thread { isResolved } } }'
   \`\`\`
   To find thread IDs, use:
   \`\`\`
   gh api repos/${repo}/pulls/${pr.number}/comments --jq '.[] | {id: .node_id, body: .body[:80], path: .path}'
   \`\`\`

10. **Request CodeRabbit re-review:**
    \`\`\`
    gh pr comment ${pr.number} --repo ${repo} --body "@coderabbitai review"
    \`\`\`

11. **Wait for CI to pass:**
    \`\`\`
    gh pr checks ${pr.number} --repo ${repo} --watch
    \`\`\`
    If any check fails, read the failure logs, fix the issue, commit, push, and repeat from step 9.

12. **Poll for review approval (up to 10 minutes):**
    Run this in a loop every 60 seconds:
    \`\`\`
    gh pr view ${pr.number} --repo ${repo} --json reviewDecision --jq .reviewDecision
    \`\`\`
    - If APPROVED: you're done, the orchestrator will auto-merge.
    - If CHANGES_REQUESTED: read new feedback and go back to step 1.
    - If still REVIEW_REQUIRED after 10 min: stop polling, the orchestrator will pick it up on next cycle.

## CRITICAL RULES
- Do NOT create a new branch. Stay on \`${prBranch}\`.
- Do NOT create a new pull request. Just push to the existing branch.
- **NEVER run \`pnpm install\`, \`pnpm add\`, \`npm install\`, or any dependency installation command.** Dependencies are already installed.
- Do not ask questions — make reasonable decisions and proceed.
- ALWAYS resolve review threads and request re-review after pushing. Never skip this step.
- For nitpicks (🧹/🔵): reply with reasoning, resolve thread, no code change needed.
- For real issues: fix code, push, resolve thread, request re-review.`

  return prompt
}
