import { spawn, execFileSync } from 'child_process'
import { mkdirSync, existsSync, appendFileSync } from 'fs'
import { join } from 'path'
import type { Config } from './config.js'
import { handleRateLimitEvent } from './rate-limit.js'

export interface WorkerResult {
  success: boolean
  prUrl?: string | null
  logFile: string
  partial: boolean
  error?: string
}

export function makeLogPath(config: Config, issueKey?: string): string {
  const safeName = (issueKey || `work-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(config.paths.logs, `${safeName}_${Date.now()}.log`)
}

export async function spawnWorker(repo: string, prompt: string, config: Config, issueKey?: string, logFile?: string): Promise<WorkerResult> {
  const repoBase = join(config.paths.repos, repo)
  const safeName = (issueKey || `work-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_')
  const branchName = `ultradev/${safeName}`

  // Ensure clone exists and is up to date
  ensureRepo(repo, repoBase)

  // Create fresh branch from default
  const defaultBranch = getDefaultBranch(repoBase)
  prepareBranch(repoBase, branchName, defaultBranch)

  if (!logFile) logFile = makeLogPath(config, issueKey)
  mkdirSync(config.paths.logs, { recursive: true })

  return new Promise((resolve) => {
    const args = [...config.claude.flags, '--print', '--output-format', 'stream-json', prompt]

    console.log(`[worker] Spawning claude in ${repoBase} (branch ${branchName})`)

    const child = spawn(config.claude.command, args, {
      cwd: repoBase,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 30 * 60 * 1000,
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
      console.log(`[worker] Claude exited with code ${code} for ${safeName}`)

      const prMatch = output.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/)
      const hasNewCommits = checkForNewCommits(repoBase, branchName, defaultBranch)

      // Reset back to default branch for next task
      try {
        execFileSync('git', ['checkout', defaultBranch], { cwd: repoBase, timeout: 10000 })
      } catch { /* ok */ }

      if (code === 0 && prMatch) {
        resolve({ success: true, prUrl: prMatch[0], logFile: logFile!, partial: false })
      } else if (code === 0 && hasNewCommits) {
        resolve({ success: true, prUrl: null, logFile: logFile!, partial: false })
      } else if (hasNewCommits) {
        resolve({ success: false, error: `Exit code ${code}, but made progress`, logFile: logFile!, partial: true })
      } else {
        resolve({ success: false, error: `Exit code ${code}`, logFile: logFile!, partial: false })
      }
    })

    child.on('error', (err: Error) => {
      resolve({ success: false, error: err.message, logFile: logFile!, partial: false })
    })
  })
}

function ensureRepo(repo: string, repoBase: string) {
  if (existsSync(join(repoBase, '.git'))) {
    try {
      execFileSync('git', ['fetch', '--all', '--prune'], { cwd: repoBase, timeout: 30000 })
      const defaultBranch = getDefaultBranch(repoBase)
      execFileSync('git', ['checkout', defaultBranch], { cwd: repoBase, timeout: 10000 })
      execFileSync('git', ['reset', '--hard', `origin/${defaultBranch}`], { cwd: repoBase, timeout: 10000 })
    } catch { /* ok */ }
  } else {
    console.log(`[worker] Cloning ${repo}`)
    mkdirSync(repoBase, { recursive: true })
    execFileSync('gh', ['repo', 'clone', repo, repoBase], { timeout: 120000 })
    // Initial install after clone
    if (existsSync(join(repoBase, 'pnpm-lock.yaml'))) {
      console.log(`[worker] Running initial pnpm install`)
      execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: repoBase, timeout: 300000 })
    }
  }
}

function prepareBranch(repoBase: string, branchName: string, defaultBranch: string) {
  // Check if branch already exists on remote (previous attempt created a PR)
  try {
    execFileSync('git', ['rev-parse', '--verify', `origin/${branchName}`], {
      cwd: repoBase, timeout: 5000,
    })
    // Remote branch exists — continue from it (don't lose previous work/PR)
    try {
      execFileSync('git', ['checkout', branchName], { cwd: repoBase, timeout: 5000 })
    } catch {
      execFileSync('git', ['checkout', '-b', branchName, `origin/${branchName}`], {
        cwd: repoBase, timeout: 5000,
      })
    }
    execFileSync('git', ['reset', '--hard', `origin/${branchName}`], {
      cwd: repoBase, timeout: 5000,
    })
    console.log(`[worker] Continuing on existing remote branch ${branchName}`)
    return
  } catch { /* no remote branch — create fresh */ }

  // Delete old local branch if it exists
  try {
    execFileSync('git', ['branch', '-D', branchName], { cwd: repoBase, timeout: 5000 })
  } catch { /* doesn't exist, fine */ }

  // Create fresh branch from default
  execFileSync('git', ['checkout', '-b', branchName, defaultBranch], {
    cwd: repoBase,
    timeout: 10000,
  })
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

function checkForNewCommits(repoBase: string, branchName: string, defaultBranch: string): boolean {
  try {
    const log = execFileSync('git', ['log', '--oneline', `${defaultBranch}..${branchName}`], {
      cwd: repoBase, encoding: 'utf-8',
    }).trim()
    return log.length > 0
  } catch { return false }
}
