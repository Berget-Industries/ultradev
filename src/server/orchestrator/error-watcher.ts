import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { spawn, execFileSync } from 'child_process'
import { type TextChannel } from 'discord.js'
import { loadConfig } from './config.js'
import { getDiscordClient, dmOwner } from './discord-bot.js'
import { logActivity } from './activity-log.js'
import { getPromptTemplate } from './prompt-loader.js'
import { renderTemplate } from '../lib/template.js'
import { prisma } from '../prisma.js'
import { resolveProjectConfig } from '../lib/project-config.js'

const dataDir = process.env.ULTRADEV_DATA_DIR || join(process.env.HOME!, '.ultradev')
const STATE_PATH = join(dataDir, 'error-watcher-state.json')

interface WatcherState {
  // channelId:authorId -> last processed message snowflake
  checkpoints: Record<string, string>
}

let timer: ReturnType<typeof setInterval> | null = null
let lastRunTime: number | null = null
let lastRunStatus: 'idle' | 'running' | 'success' | 'error' = 'idle'
let lastRunError: string | null = null
let lastRunIssuesCreated = 0

function loadState(): WatcherState {
  if (!existsSync(STATE_PATH)) return { checkpoints: {} }
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
  } catch {
    return { checkpoints: {} }
  }
}

function saveState(state: WatcherState) {
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

export function getErrorWatcherState() {
  const config = loadConfig()
  return {
    enabled: config.errorWatcher.enabled,
    intervalMs: config.errorWatcher.intervalMs,
    targetRepo: config.errorWatcher.targetRepo,
    labels: config.errorWatcher.labels,
    lastRunTime,
    lastRunStatus,
    lastRunError,
    lastRunIssuesCreated,
    watchedChannels: config.errorWatcher.watchedChannels.map(r => ({
      channelId: r.channelId,
      authorId: r.authorId,
    })),
  }
}

export function startErrorWatcher() {
  const config = loadConfig()
  if (!config.errorWatcher.enabled) {
    console.log('[error-watcher] Disabled')
    return
  }

  // Allow startup if either global targetRepo is set OR per-project watchers may exist
  // The actual project check happens at runtime in runErrorWatcher()
  if (!config.errorWatcher.targetRepo && config.errorWatcher.watchedChannels.length === 0) {
    // Still start — per-project watchers may be configured in the DB
    console.log('[error-watcher] No global target/channels, will check per-project configs')
  } else if (config.errorWatcher.targetRepo) {
    console.log(`[error-watcher] Global target: ${config.errorWatcher.targetRepo}, ${config.errorWatcher.watchedChannels.length} channel(s)`)
  }

  console.log(`[error-watcher] Starting, interval ${config.errorWatcher.intervalMs / 1000 / 60 / 60}h`)

  // Run once shortly after startup (30s delay to let Discord connect)
  setTimeout(() => runErrorWatcher(), 30_000)

  timer = setInterval(() => runErrorWatcher(), config.errorWatcher.intervalMs)
}

export function stopErrorWatcher() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/**
 * Extract owner/repo from a GitHub URL like https://github.com/owner/repo or https://github.com/owner/repo.git
 */
function extractOwnerRepo(repoUrl: string): string | null {
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/.]+)/)
  return match ? match[1] : null
}

export async function runErrorWatcher() {
  const config = loadConfig()
  const client = getDiscordClient()

  if (!client) return

  lastRunStatus = 'running'
  lastRunError = null
  lastRunIssuesCreated = 0
  logActivity('error-watcher', 'Starting error scan...')

  try {
    const state = loadState()
    let totalErrors = 0
    let totalIssuesCreated = 0
    let totalSkipped = 0
    const allDetails: string[] = []

    // Find projects with error watcher enabled
    const projects = await prisma.project.findMany({
      where: { errorWatcherEnabled: true },
    })

    if (projects.length > 0) {
      // Per-project error watching
      for (const project of projects) {
        const projectConfig = resolveProjectConfig(project, config)
        const channelId = projectConfig.errorWatcherChannel
        const targetRepo = extractOwnerRepo(project.repoUrl)

        if (!channelId || !targetRepo) {
          console.log(`[error-watcher] Project "${project.name}" missing channel or repo URL, skipping`)
          continue
        }

        const key = `channel:${channelId}`
        const afterId = state.checkpoints[key] || null

        const messages = await fetchAllChannelMessages(channelId, afterId)

        if (messages.length > 0) {
          const latest = messages[messages.length - 1]
          state.checkpoints[key] = latest.messageId
        }

        console.log(`[error-watcher] Project "${project.name}" (${channelId}): ${messages.length} new message(s)`)

        if (messages.length > 0) {
          totalErrors += messages.length
          const result = await analyzeAndCreateIssues(messages, targetRepo, projectConfig.errorWatcherLabels)
          totalIssuesCreated += result.issuesCreated
          totalSkipped += result.skipped
          if (result.details) allDetails.push(`**${project.name}**: ${result.details}`)
        }
      }
    } else if (config.errorWatcher.targetRepo) {
      // Fallback: global error watcher using watched channels
      const allErrors: Array<{ channelId: string; authorId: string; messageId: string; content: string; timestamp: Date }> = []

      for (const rule of config.errorWatcher.watchedChannels) {
        const key = `${rule.channelId}:${rule.authorId}`
        const afterId = state.checkpoints[key] || null

        const messages = await fetchChannelMessages(rule.channelId, rule.authorId, afterId)

        if (messages.length > 0) {
          allErrors.push(...messages)
          const latest = messages[messages.length - 1]
          state.checkpoints[key] = latest.messageId
        }

        console.log(`[error-watcher] ${key}: ${messages.length} new message(s)`)
      }

      if (allErrors.length > 0) {
        totalErrors = allErrors.length
        const result = await analyzeAndCreateIssues(allErrors, config.errorWatcher.targetRepo, config.errorWatcher.labels)
        totalIssuesCreated = result.issuesCreated
        totalSkipped = result.skipped
        if (result.details) allDetails.push(result.details)
      }
    } else {
      lastRunStatus = 'success'
      lastRunTime = Date.now()
      logActivity('error-watcher', 'No projects or global target configured')
      return
    }

    saveState(state)

    if (totalErrors === 0) {
      lastRunStatus = 'success'
      lastRunTime = Date.now()
      logActivity('error-watcher', 'No new errors found')
      return
    }

    lastRunIssuesCreated = totalIssuesCreated
    lastRunStatus = 'success'
    lastRunTime = Date.now()

    const summary = `Error watcher: scanned ${totalErrors} error(s), created ${totalIssuesCreated} issue(s)${totalSkipped > 0 ? `, skipped ${totalSkipped} duplicate(s)` : ''}`
    logActivity('error-watcher', summary)

    await dmOwner(`**Error Watcher Report**\n${summary}\n\n${allDetails.join('\n\n')}`)

  } catch (err: any) {
    lastRunStatus = 'error'
    lastRunError = err.message
    lastRunTime = Date.now()
    console.error('[error-watcher] Failed:', err.message)
    logActivity('error-watcher', `Failed: ${err.message}`)
    await dmOwner(`**Error Watcher Failed**\n${err.message}`)
  }
}

async function fetchChannelMessages(
  channelId: string,
  authorId: string,
  afterMessageId: string | null,
): Promise<Array<{ channelId: string; authorId: string; messageId: string; content: string; timestamp: Date }>> {
  const client = getDiscordClient()
  if (!client) return []

  try {
    const channel = await client.channels.fetch(channelId)
    if (!channel || !('messages' in channel)) return []

    const textChannel = channel as TextChannel
    const options: { limit: number; after?: string } = { limit: 100 }
    if (afterMessageId) {
      options.after = afterMessageId
    }

    const fetched = await textChannel.messages.fetch(options)

    // Filter to only the target author, sort chronologically
    const filtered = [...fetched.values()]
      .filter(m => m.author.id === authorId)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)

    return filtered.map(m => ({
      channelId,
      authorId,
      messageId: m.id,
      content: m.content || (m.embeds.length > 0 ? m.embeds.map(e => `${e.title || ''}\n${e.description || ''}`).join('\n---\n') : ''),
      timestamp: m.createdAt,
    })).filter(m => m.content.trim().length > 0)
  } catch (err: any) {
    console.error(`[error-watcher] Failed to fetch messages from ${channelId}:`, err.message)
    return []
  }
}

async function fetchAllChannelMessages(
  channelId: string,
  afterMessageId: string | null,
): Promise<Array<{ channelId: string; authorId: string; messageId: string; content: string; timestamp: Date }>> {
  const client = getDiscordClient()
  if (!client) return []

  try {
    const channel = await client.channels.fetch(channelId)
    if (!channel || !('messages' in channel)) return []

    const textChannel = channel as TextChannel
    const options: { limit: number; after?: string } = { limit: 100 }
    if (afterMessageId) {
      options.after = afterMessageId
    }

    const fetched = await textChannel.messages.fetch(options)

    const sorted = [...fetched.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)

    return sorted.map(m => ({
      channelId,
      authorId: m.author.id,
      messageId: m.id,
      content: m.content || (m.embeds.length > 0 ? m.embeds.map(e => `${e.title || ''}\n${e.description || ''}`).join('\n---\n') : ''),
      timestamp: m.createdAt,
    })).filter(m => m.content.trim().length > 0)
  } catch (err: any) {
    console.error(`[error-watcher] Failed to fetch messages from ${channelId}:`, err.message)
    return []
  }
}

interface AnalysisResult {
  issuesCreated: number
  skipped: number
  details: string
}

async function analyzeAndCreateIssues(
  errors: Array<{ content: string; timestamp: Date; messageId: string }>,
  targetRepo: string,
  labels: string[],
): Promise<AnalysisResult> {
  const errorSummary = errors.map((e, i) =>
    `### Error ${i + 1} (${e.timestamp.toISOString()})\n\`\`\`\n${e.content.slice(0, 2000)}\n\`\`\``
  ).join('\n\n')

  const labelsFlag = labels.map(l => `--label "${l}"`).join(' ')

  let tmpl: Awaited<ReturnType<typeof getPromptTemplate>> = null
  try {
    tmpl = await getPromptTemplate('error-triage')
  } catch (err: any) {
    console.error('[error-watcher] Failed to load prompt template:', err.message)
  }
  let renderedPrompt: string | null = null
  if (tmpl) {
    try {
      renderedPrompt = renderTemplate(tmpl.template, { target_repo: targetRepo, error_summary: errorSummary, labels_flag: labelsFlag })
    } catch (err: any) {
      console.error('[error-watcher] Failed to render prompt template:', err.message)
    }
  }
  const prompt = renderedPrompt
    ?? `You are UltraDev's error triage system. Analyze these production error messages from Discord and create GitHub issues for actionable problems.

## Target repo: ${targetRepo}

## Errors to analyze:

${errorSummary}

## Instructions:

1. First, search for existing open issues in ${targetRepo} that might already cover these errors:
   Run: gh issue list --repo ${targetRepo} --state open --limit 50 --json number,title,body

2. Group and deduplicate the errors. Multiple messages about the same root cause = one issue.

3. For each unique, actionable error that does NOT already have an open issue:
   - Create a GitHub issue with a clear title and description
   - Include the error details, timestamps, and any stack traces
   - Run: gh issue create --repo ${targetRepo} --title "<title>" --body "<body>" ${labelsFlag}

4. Skip errors that:
   - Already have an open issue covering them
   - Are transient/non-actionable (e.g., network timeouts that self-resolved)
   - Are informational, not actual errors

5. At the end, output a summary in this exact format:
   SUMMARY: created=N skipped=N
   DETAILS: <one-line description per issue created or skipped>

Be thorough but conservative — only create issues for real problems.`

  return new Promise((resolve) => {
    const config = loadConfig()
    const child = spawn(config.claude.command, [
      ...config.claude.flags,
      '--print',
      prompt,
    ], {
      cwd: join(config.paths.repos, targetRepo),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 5 * 60 * 1000,
    })

    let output = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => { output += data.toString() })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        console.error('[error-watcher] Claude analysis failed:', stderr)
      }

      // Parse summary from output
      const summaryMatch = output.match(/SUMMARY:\s*created=(\d+)\s+skipped=(\d+)/)
      const detailsMatch = output.match(/DETAILS:\s*([\s\S]*)$/)

      resolve({
        issuesCreated: summaryMatch ? parseInt(summaryMatch[1]) : 0,
        skipped: summaryMatch ? parseInt(summaryMatch[2]) : 0,
        details: detailsMatch ? detailsMatch[1].trim().slice(0, 1500) : output.slice(-500),
      })
    })

    child.on('error', (err) => {
      console.error('[error-watcher] Spawn error:', err.message)
      resolve({ issuesCreated: 0, skipped: 0, details: `Spawn error: ${err.message}` })
    })
  })
}
