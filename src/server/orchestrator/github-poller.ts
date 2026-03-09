import { execFileSync } from 'child_process'
import { spawnWorker, makeLogPath } from './worker.js'
import { getIssueState, setIssueState } from './state.js'
import { notify } from './notifier.js'
import { releaseWorkerSlot } from './worker-lock.js'
import { getPromptTemplate } from './prompt-loader.js'
import { renderTemplate } from '../lib/template.js'
import type { Config } from './config.js'

interface IssueSummary {
  repository: { nameWithOwner: string }
  number: number
  title: string
}

export async function handleIssue(issue: IssueSummary, config: Config, attempt: number) {
  const repo = issue.repository.nameWithOwner
  const num = issue.number
  const key = `${repo}#${num}`

  // activeWorkers already incremented by caller
  const logFile = makeLogPath(config, key)
  setIssueState(key, { status: 'in_progress', attempts: attempt, repo, number: num, logFile })

  try {
    const body = execFileSync('gh', [
      'issue', 'view', String(num),
      '--repo', repo,
      '--json', 'title,body,comments,labels',
    ], { encoding: 'utf-8', timeout: 15000 })

    const detail = JSON.parse(body)
    const existingPrUrl = getIssueState(key)?.prUrl || null
    const prompt = await buildPrompt(repo, num, detail, existingPrUrl)

    notify(`⚙️ Working on **${key}** (attempt ${attempt})...`)
    const result = await spawnWorker(repo, prompt, config, key, logFile)

    if (result.success && result.prUrl) {
      const existingUrls = getIssueState(key)?.prUrls || []
      const prUrls = existingUrls.includes(result.prUrl) ? existingUrls : [...existingUrls, result.prUrl]
      setIssueState(key, { status: 'done', prUrl: result.prUrl, prUrls, logFile: result.logFile })
      notify(`✅ **${key}** — PR created: ${result.prUrl}`)
    } else if (result.success) {
      setIssueState(key, { status: 'done', prUrl: null, logFile: result.logFile })
      notify(`✅ **${key}** — Completed (no PR URL captured).`)
    } else if (result.partial) {
      setIssueState(key, { status: 'failed', error: result.error, madeProgress: true, logFile: result.logFile })
      notify(`⏸️ **${key}** — Partial progress, will retry. (${result.error})`)
    } else {
      setIssueState(key, { status: 'failed', error: result.error, logFile: result.logFile })
      notify(`❌ **${key}** — Failed (attempt ${attempt}): ${result.error}`)
    }
  } catch (err: any) {
    console.error(`[poller] Error handling ${key}:`, err.message)
    setIssueState(key, { status: 'failed', error: err.message, logFile })
    notify(`❌ **${key}** — Error: ${err.message}`)
  } finally {
    releaseWorkerSlot()
  }
}


async function buildPrompt(repo: string, number: number, detail: any, existingPrUrl: string | null): Promise<string> {
  const comments = (detail.comments || [])
    .map((c: any) => `**${c.author.login}**: ${c.body}`)
    .join('\n\n')

  const ciWaitStep = `8. After pushing, wait for CI checks to complete. Run this in a loop every 30 seconds until all checks finish:
   \`gh pr checks <PR_NUMBER> --repo ${repo} --watch\`
   If any check fails, read the failure logs, fix the issue, commit, and push again. Repeat until CI is green.`

  const prInstructions = existingPrUrl
    ? `5. Commit your changes with a clear message referencing #${number}.
6. Push your commits to this branch: \`git push origin HEAD\`
7. The existing PR (${existingPrUrl}) will be updated automatically. Do NOT create a new PR.
${ciWaitStep}`
    : `5. Commit your changes with a clear message referencing #${number}.
6. Push this branch and create a pull request using \`gh pr create\`.
7. The PR title should reference the issue. The PR body should explain what you changed and why.
${ciWaitStep}`

  const resumeContext = existingPrUrl
    ? `## IMPORTANT: Resuming Previous Work

A PR already exists for this issue: ${existingPrUrl}
Before doing anything, check the current state:
1. Run \`git log --oneline -5\` to see what commits already exist on this branch.
2. Run \`gh pr checks <PR_NUMBER> --repo ${repo}\` to check CI status.
3. If all CI checks pass, your work is DONE — just output "All CI checks passing, nothing to do." and exit.
4. If CI is still running, wait for it: \`gh pr checks <PR_NUMBER> --repo ${repo} --watch\`
5. If CI failed, read the failure logs, fix the issues, and push again.
6. If the PR needs more work beyond CI fixes, proceed with the instructions below.

`
    : ''

  const existingPrRule = existingPrUrl ? '\n- Do NOT create a new pull request. Push to the existing branch.' : ''
  const commentsSection = comments ? `## Comments\n\n${comments}` : ''

  const tmpl = await getPromptTemplate('issue-worker')
  if (tmpl) {
    return renderTemplate(tmpl.template, {
      repo,
      number: String(number),
      title: detail.title,
      body: detail.body || 'No description provided.',
      comments_section: commentsSection,
      resume_context: resumeContext,
      pr_instructions: prInstructions,
      existing_pr_rule: existingPrRule,
    })
  }

  return `You are working on issue #${number} in ${repo}.

## Issue: ${detail.title}

${detail.body || 'No description provided.'}

${commentsSection}

${resumeContext}## Instructions

1. Read and understand the issue thoroughly.
2. Explore the codebase to understand the relevant code.
3. Implement the fix or feature described in the issue.
4. Make sure the code works — run tests if they exist. Use \`pnpm --filter <package> test\` to run tests.
${prInstructions}

## CRITICAL RULES
- **NEVER run \`pnpm install\`, \`pnpm add\`, \`npm install\`, or any dependency installation command.** Dependencies are already installed. If something appears missing, work around it — do NOT install.
- You are already on the correct branch. Do not create or switch branches.${existingPrRule}
- Do not ask questions — make reasonable decisions and proceed.`
}

