import { execFileSync } from 'child_process'
import { spawnWorker, makeLogPath } from './worker.js'
import { getIssueState, setIssueState } from './state.js'
import { notify } from './notifier.js'
import { releaseWorkerSlot } from './worker-lock.js'
import { getPromptTemplate } from './prompt-loader.js'
import { renderTemplate } from '../lib/template.js'
import type { Config } from './config.js'
import type { ProjectConfig } from '../lib/project-config.js'

interface IssueSummary {
  repository: { nameWithOwner: string }
  number: number
  title: string
}

export async function handleIssue(issue: IssueSummary, config: Config, attempt: number, projectConfig?: ProjectConfig) {
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
    const result = await spawnWorker(repo, prompt, config, key, logFile, projectConfig?.workerTimeoutMs)

    const shouldNotifySuccess = projectConfig?.notifyOnSuccess ?? true
    const shouldNotifyFailure = projectConfig?.notifyOnFailure ?? true

    if (result.success && result.prUrl) {
      const existingUrls = getIssueState(key)?.prUrls || []
      const prUrls = existingUrls.includes(result.prUrl) ? existingUrls : [...existingUrls, result.prUrl]
      setIssueState(key, { status: 'done', prUrl: result.prUrl, prUrls, logFile: result.logFile })
      if (shouldNotifySuccess) notify(`✅ **${key}** — PR created: ${result.prUrl}`)
    } else if (result.success) {
      setIssueState(key, { status: 'done', prUrl: null, logFile: result.logFile })
      if (shouldNotifySuccess) notify(`✅ **${key}** — Completed (no PR URL captured).`)
    } else if (result.partial) {
      setIssueState(key, { status: 'failed', error: result.error, madeProgress: true, logFile: result.logFile })
      if (shouldNotifyFailure) notify(`⏸️ **${key}** — Partial progress, will retry. (${result.error})`)
    } else {
      setIssueState(key, { status: 'failed', error: result.error, logFile: result.logFile })
      if (shouldNotifyFailure) notify(`❌ **${key}** — Failed (attempt ${attempt}): ${result.error}`)
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

  const changesetStep = `5. **Create a changeset** (REQUIRED):
   - Check if \`.changeset/config.json\` exists. If it does, this repo uses changesets.
   - Check if a changeset file already exists in \`.changeset/\` (any \`.md\` file other than \`README.md\`). If one already exists, skip creating a new one.
   - If no changeset exists, create one: \`.changeset/<adjective>-<noun>.md\` (e.g., \`brave-pandas.md\`) with format:
     \`\`\`
     ---
     "<package-name>": patch
     ---

     <Summary of what changed and why>
     \`\`\`
   - Use \`patch\` for bug fixes, \`minor\` for new features, \`major\` for breaking changes.
   - Find the package name from the root \`package.json\` \`name\` field.
   - If the repo doesn't use changesets (no \`.changeset/config.json\`), skip this step.`

  const coderabbitLoop = `
## CRITICAL: Close the CodeRabbit review loop

After creating/updating the PR, you MUST:

A. **Wait for CI:** \`gh pr checks <PR_NUMBER> --repo ${repo} --watch\`
   If any check fails, fix the issue, commit, push, and repeat.

B. **Request CodeRabbit review:**
   \`gh pr comment <PR_NUMBER> --repo ${repo} --body "@coderabbitai review"\`

C. **Poll for review decision (up to 10 minutes):**
   Run every 60 seconds:
   \`gh pr view <PR_NUMBER> --repo ${repo} --json reviewDecision --jq .reviewDecision\`
   - If APPROVED + CI green: \`gh pr merge <PR_NUMBER> --repo ${repo} --squash --delete-branch --auto\`
   - If CHANGES_REQUESTED: read feedback, triage (nitpicks vs real issues), fix, push, resolve threads, request re-review, repeat.
   - If REVIEW_REQUIRED after 10 min: stop, orchestrator will handle next cycle.

D. **Handling CodeRabbit feedback:**
   - 🧹 Nitpick / 🔵 Trivial: reply with brief reasoning, resolve thread, no code change needed.
   - Real issues: fix code, push, resolve ALL threads, then \`@coderabbitai review\`.

E. **Verify issue closure:**
   After merge, check: \`gh issue view ${number} --repo ${repo} --json state --jq .state\`
   If still open: \`gh issue close ${number} --repo ${repo}\``

  const prInstructions = existingPrUrl
    ? `${changesetStep}
6. Commit your changes with a clear message referencing #${number}.
7. Push your commits to this branch: \`git push origin HEAD\`
8. The existing PR (${existingPrUrl}) will be updated automatically. Do NOT create a new PR.
${coderabbitLoop}`
    : `${changesetStep}
6. Commit your changes with a clear message referencing #${number}.
7. Push this branch and create a pull request using \`gh pr create\`.
8. The PR title should reference the issue. The PR body should explain what you changed and why.
${coderabbitLoop}`

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

