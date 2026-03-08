import { spawn, execFileSync } from 'child_process'
import { mkdirSync, existsSync, appendFileSync } from 'fs'
import { join } from 'path'
import type { Config } from './config.js'
import type { WorkerResult } from './worker.js'
import { handleRateLimitEvent } from './rate-limit.js'
import { getPromptTemplate } from './prompt-loader.js'
import { renderTemplate } from '../lib/template.js'

interface ConflictPr {
  number: number
  title: string
  url: string
}

export async function spawnConflictWorker(
  repo: string,
  pr: ConflictPr,
  headRefName: string,
  baseRefName: string,
  config: Config,
  logFile?: string,
): Promise<WorkerResult> {
  const repoBase = join(config.paths.repos, repo)

  ensureRepo(repo, repoBase)

  // Check out the PR branch
  try {
    execFileSync('git', ['fetch', 'origin', headRefName, baseRefName], { cwd: repoBase, timeout: 30000 })
    execFileSync('git', ['checkout', headRefName], { cwd: repoBase, timeout: 10000 })
    execFileSync('git', ['reset', '--hard', `origin/${headRefName}`], { cwd: repoBase, timeout: 10000 })
  } catch (err: any) {
    return { success: false, error: `Branch setup failed: ${err.message}`, partial: false, logFile: '' }
  }

  const prompt = await buildConflictPrompt(repo, pr, headRefName, baseRefName)

  if (!logFile) logFile = join(config.paths.logs, `conflict_${pr.number}-${Date.now()}.log`)
  mkdirSync(config.paths.logs, { recursive: true })

  return new Promise((resolve) => {
    const args = [...config.claude.flags, '--print', '--output-format', 'stream-json', prompt]

    console.log(`[conflict-worker] Spawning claude in ${repoBase} on branch ${headRefName}`)

    const child = spawn(config.claude.command, args, {
      cwd: repoBase,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 15 * 60 * 1000, // 15 min — conflicts should be quicker
    })

    let output = ''
    let lineBuf = ''

    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString()
      output += chunk
      appendFileSync(logFile, data)

      lineBuf += chunk
      const lines = lineBuf.split('\n')
      lineBuf = lines.pop() || ''
      for (const line of lines) {
        try {
          const event = JSON.parse(line.trim())
          if (event.type === 'rate_limit_event' && event.rate_limit_info) {
            handleRateLimitEvent(event.rate_limit_info)
          }
        } catch { /* not json */ }
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      appendFileSync(logFile, data)
    })

    child.on('close', (code: number | null) => {
      console.log(`[conflict-worker] Claude exited with code ${code}`)

      let pushed = false
      try {
        const local = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoBase, encoding: 'utf-8', timeout: 5000 }).trim()
        const remote = execFileSync('git', ['rev-parse', `origin/${headRefName}`], { cwd: repoBase, encoding: 'utf-8', timeout: 5000 }).trim()
        pushed = local !== remote
      } catch { /* can't tell */ }

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

async function buildConflictPrompt(
  repo: string,
  pr: ConflictPr,
  headRefName: string,
  baseRefName: string,
): Promise<string> {
  const tmpl = await getPromptTemplate('conflict-resolver')
  if (tmpl) {
    return renderTemplate(tmpl.template, {
      repo,
      pr_number: String(pr.number),
      pr_title: pr.title,
      head_ref: headRefName,
      base_ref: baseRefName,
    })
  }

  return `You are resolving merge conflicts on PR #${pr.number} in ${repo}.

## PR: ${pr.title}

## Situation
This PR's branch \`${headRefName}\` has merge conflicts with \`${baseRefName}\`.
The base branch has moved ahead and some files conflict.

## Instructions

1. First, understand the current state:
   \`\`\`
   git log --oneline -5
   git log --oneline origin/${baseRefName}..HEAD
   \`\`\`

2. Rebase onto the latest base branch:
   \`\`\`
   git rebase origin/${baseRefName}
   \`\`\`

3. If there are conflicts:
   - Read each conflicting file carefully
   - Understand the intent of BOTH sides (the PR changes AND the base branch changes)
   - Resolve conflicts preserving the intent of both changes
   - \`git add <resolved files>\` then \`git rebase --continue\`

4. After the rebase is complete:
   - Make sure the code compiles/builds if applicable
   - Run tests if they exist: \`pnpm --filter <package> test\`
   - Force push: \`git push origin ${headRefName} --force-with-lease\`

5. After pushing, verify CI passes: \`gh pr checks ${pr.number} --repo ${repo} --watch\`
   If any check fails, fix and push again.

## CRITICAL RULES
- Stay on branch \`${headRefName}\`. Do NOT create new branches.
- Do NOT create a new PR. The existing PR will update automatically.
- **NEVER run \`pnpm install\`, \`pnpm add\`, \`npm install\`, or any dependency installation command.**
- Use \`--force-with-lease\` (not \`--force\`) when pushing the rebase.
- Do not ask questions — make reasonable decisions and proceed.
- When resolving conflicts, preserve the intent of BOTH sides. Do not drop changes.`
}
