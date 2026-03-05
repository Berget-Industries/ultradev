import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { spawn, execFileSync } from 'child_process'
import { type TextChannel } from 'discord.js'
import { loadConfig } from './config.js'
import { getDiscordClient, dmOwner } from './discord-bot.js'
import { logActivity } from './activity-log.js'

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
    watchedChannels: config.discord.triggerWhitelist.map(r => ({
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
  if (!config.errorWatcher.targetRepo) {
    console.log('[error-watcher] No target repo configured, skipping')
    return
  }
  if (config.discord.triggerWhitelist.length === 0) {
    console.log('[error-watcher] No channels to watch, skipping')
    return
  }

  console.log(`[error-watcher] Watching ${config.discord.triggerWhitelist.length} channel(s), interval ${config.errorWatcher.intervalMs / 1000 / 60 / 60}h, target ${config.errorWatcher.targetRepo}`)

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

export async function runErrorWatcher() {
  const config = loadConfig()
  const client = getDiscordClient()

  if (!client || !config.errorWatcher.targetRepo) return

  lastRunStatus = 'running'
  lastRunError = null
  lastRunIssuesCreated = 0
  logActivity('error-watcher', 'Starting error scan...')

  try {
    const state = loadState()
    const allErrors: Array<{ channelId: string; authorId: string; messageId: string; content: string; timestamp: Date }> = []

    for (const rule of config.discord.triggerWhitelist) {
      const key = `${rule.channelId}:${rule.authorId}`
      const afterId = state.checkpoints[key] || null

      const messages = await fetchChannelMessages(rule.channelId, rule.authorId, afterId)

      if (messages.length > 0) {
        allErrors.push(...messages)
        // Update checkpoint to latest message
        const latest = messages[messages.length - 1]
        state.checkpoints[key] = latest.messageId
      }

      console.log(`[error-watcher] ${key}: ${messages.length} new message(s)`)
    }

    saveState(state)

    if (allErrors.length === 0) {
      lastRunStatus = 'success'
      lastRunTime = Date.now()
      logActivity('error-watcher', 'No new errors found')
      return
    }

    console.log(`[error-watcher] Found ${allErrors.length} new error message(s), analyzing...`)
    logActivity('error-watcher', `Found ${allErrors.length} new error(s), analyzing...`)

    // Send to Claude for analysis + issue creation
    const result = await analyzeAndCreateIssues(allErrors, config.errorWatcher.targetRepo, config.errorWatcher.labels)

    lastRunIssuesCreated = result.issuesCreated
    lastRunStatus = 'success'
    lastRunTime = Date.now()

    const summary = `Error watcher: scanned ${allErrors.length} error(s), created ${result.issuesCreated} issue(s)${result.skipped > 0 ? `, skipped ${result.skipped} duplicate(s)` : ''}`
    logActivity('error-watcher', summary)

    // DM owner the summary
    await dmOwner(`**Error Watcher Report**\n${summary}\n\n${result.details}`)

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

  const prompt = `You are UltraDev's error triage system. Analyze these production error messages from Discord and create GitHub issues for actionable problems.

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
