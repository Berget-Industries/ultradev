import { Client, GatewayIntentBits, Partials, ChannelType, type Message, type DMChannel, type Collection, type TextChannel } from 'discord.js'
import { execFileSync, spawn } from 'child_process'
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { loadConfig, type TriggerRule } from './config.js'
import { notify } from './notifier.js'
import { spawnWorker } from './worker.js'
import { getAllIssues } from './state.js'
import { tryHeal } from './self-heal.js'
import { getPromptTemplate } from './prompt-loader.js'
import { renderTemplate } from '../lib/template.js'

let client: Client | null = null
let botStatus: 'offline' | 'online' | 'error' = 'offline'

export function getDiscordBotStatus() {
  return botStatus
}

export function getDiscordClient(): Client | null {
  return client
}

export async function dmOwner(text: string) {
  const config = loadConfig()
  if (!client || !config.discord.ownerUserId) return
  try {
    const user = await client.users.fetch(config.discord.ownerUserId)
    const dm = await user.createDM()
    if (text.length <= 2000) {
      await dm.send(text)
    } else {
      const chunks = text.match(/[\s\S]{1,1990}/g) || []
      for (const chunk of chunks) {
        await dm.send(chunk)
      }
    }
  } catch (err: any) {
    console.error('[discord] Failed to DM owner:', err.message)
  }
}

export async function sendToChannel(channelId: string, text: string) {
  if (!client) return
  try {
    const channel = await client.channels.fetch(channelId)
    if (!channel || !channel.isTextBased()) {
      console.error(`[discord] Channel ${channelId} not found or not text-based`)
      return
    }
    const sendable = channel as TextChannel
    if (text.length <= 2000) {
      await sendable.send(text)
    } else {
      const chunks = text.match(/[\s\S]{1,1990}/g) || []
      for (const chunk of chunks) {
        await sendable.send(chunk)
      }
    }
  } catch (err: any) {
    console.error(`[discord] Failed to send to channel ${channelId}:`, err.message)
  }
}

export async function startDiscordBot() {
  const config = loadConfig()

  if (!config.discord.token) {
    console.log('[discord] No token configured, skipping bot')
    return null
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  })

  client.once('clientReady', () => {
    console.log(`[discord] Bot online as ${client!.user!.tag}`)
    botStatus = 'online'
    notify('UltraDev online. Watching for issues.')
  })

  client.on('messageCreate', async (msg) => {
    if (msg.author.id === client!.user!.id) return

    const isDM = msg.channel.type === ChannelType.DM

    if (isDM) {
      await handleDM(msg)
    } else {
      await handleChannelMessage(msg)
    }
  })

  try {
    await client.login(config.discord.token)
  } catch (err: any) {
    console.error('[discord] Login failed:', err.message)
    botStatus = 'error'
  }

  return client
}

// --- DM: only owner, conversational with history ---

async function handleDM(msg: Message) {
  const config = loadConfig()

  if (!config.discord.ownerUserId || msg.author.id !== config.discord.ownerUserId) {
    return // silent ignore for non-owner DMs
  }

  await handleInteractiveMessage(msg)
}

// --- Channel messages: respond to whitelisted channel+author pairs ---

async function handleChannelMessage(msg: Message) {
  const config = loadConfig()

  const isWhitelisted = config.discord.triggerWhitelist.some(
    rule => rule.channelId === msg.channelId && rule.authorId === msg.author.id
  )
  if (!isWhitelisted) return

  await handleInteractiveMessage(msg)
}

// --- Shared interactive message handler (commands + conversational chat) ---

async function handleInteractiveMessage(msg: Message) {
  const config = loadConfig()
  const content = msg.content.trim()
  if (!content) return

  if (content === '!status') {
    const issues = getAllIssues()
    const inProgress = Object.entries(issues).filter(([, v]) => v.status === 'in_progress')
    const done = Object.entries(issues).filter(([, v]) => v.status === 'done')
    const failed = Object.entries(issues).filter(([, v]) => v.status === 'failed')
    let reply = 'Online. Polling GitHub for assigned issues.\n'
    if (inProgress.length) reply += `In progress: ${inProgress.map(([k]) => k).join(', ')}\n`
    if (done.length) reply += `Done: ${done.map(([k]) => k).join(', ')}\n`
    if (failed.length) reply += `Failed: ${failed.map(([k]) => k).join(', ')}\n`
    await msg.reply(reply)
    return
  }

  if (content === '!ping') {
    await msg.reply('pong')
    return
  }

  if (content === '!repos') {
    const repoDir = config.paths.repos
    if (!existsSync(repoDir)) {
      await msg.reply('No repos cloned yet.')
      return
    }
    const orgs = readdirSync(repoDir)
    const repos: string[] = []
    for (const org of orgs) {
      const orgPath = join(repoDir, org)
      try {
        const names = readdirSync(orgPath)
        for (const name of names) repos.push(`${org}/${name}`)
      } catch { /* not a dir */ }
    }
    await msg.reply(repos.length ? `Repos:\n${repos.map(r => `- ${r}`).join('\n')}` : 'No repos cloned yet.')
    return
  }

  const workMatch = content.match(/^!work\s+([\w-]+\/[\w.-]+)#(\d+)$/)
  if (workMatch) {
    await handleWork(msg, workMatch[1], parseInt(workMatch[2]), config)
    return
  }

  if (content === '!help') {
    await msg.reply(`**Commands:**
\`!ping\` — health check
\`!status\` — current work status
\`!work owner/repo#123\` — work on an issue
\`!repos\` — list cloned repos
\`!help\` — this message
Or just talk — I'll respond with context from conversation history`)
    return
  }

  if (content.startsWith('!')) return

  // Conversational: fetch history as context
  if ('sendTyping' in msg.channel) await msg.channel.sendTyping()

  try {
    const history = await fetchMessageHistory(msg.channel as DMChannel | TextChannel, msg.id)
    const reply = await chatWithClaude(content, msg.author.username, history)
    await sendLongReply(msg, reply)
  } catch (err: any) {
    console.error('[discord] Chat error:', err.message)
    await msg.reply(`Error: \`${err.message}\``)
    tryHeal('discord-chat', err.message, { file: 'discord-bot.ts', extra: `User message: "${content}"` })
  }
}

// --- Shared helpers ---

async function handleWork(msg: Message, repo: string, num: number, config: ReturnType<typeof loadConfig>) {
  await msg.reply(`Working on ${repo}#${num}...`)

  try {
    const detail = ghIssueView(repo, num)
    const prompt = buildPrompt(repo, num, detail)
    const result = await spawnWorker(repo, prompt, config)

    if (result.success && result.prUrl) {
      await msg.reply(`Done! PR: ${result.prUrl}`)
    } else if (result.success) {
      await msg.reply(`Done, but no PR URL found. Check logs.`)
    } else {
      await msg.reply(`Failed: ${result.error}`)
    }
  } catch (err: any) {
    await msg.reply(`Error: ${err.message}`)
  }
}

async function fetchMessageHistory(channel: DMChannel | TextChannel, beforeMessageId: string): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

  try {
    const fetched = await channel.messages.fetch({ limit: 50, before: beforeMessageId })

    // Discord returns newest first, reverse for chronological order
    const sorted = [...fetched.values()].reverse()

    for (const m of sorted) {
      if (!m.content.trim()) continue
      // Skip command messages
      if (m.content.trim().startsWith('!')) continue

      const isBot = m.author.id === client!.user!.id
      messages.push({
        role: isBot ? 'assistant' : 'user',
        content: m.content.trim(),
      })
    }
  } catch (err: any) {
    console.error('[discord] Failed to fetch DM history:', err.message)
  }

  return messages
}

async function chatWithClaude(message: string, username: string, history: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
  const config = loadConfig()

  // Build conversation context from DM history
  let conversationContext = ''
  if (history.length > 0) {
    conversationContext = '\n\n## Recent conversation history:\n' +
      history.map(m => `${m.role === 'user' ? username : 'UltraDev'}: ${m.content}`).join('\n') +
      '\n\n## Current message:\n'
  }

  const tmpl = await getPromptTemplate('discord-chat')
  const systemPrompt = tmpl
    ? renderTemplate(tmpl.template, {
        username,
        conversation_context: conversationContext,
        message,
      })
    : `You are UltraDev, an autonomous AI developer bot. You're talking to ${username} in a DM. Be concise, helpful, and direct. No fluff.${conversationContext}${message}`

  return new Promise((resolve, reject) => {
    const child = spawn(config.claude.command, [
      ...config.claude.flags,
      '--print',
      systemPrompt,
    ], {
      cwd: process.env.HOME!,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60 * 1000,
    })

    let output = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => { output += data.toString() })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    child.on('close', (code: number | null) => {
      if (code === 0 && output.trim()) {
        resolve(output.trim())
      } else {
        reject(new Error(stderr || `Claude exited with code ${code}`))
      }
    })

    child.on('error', reject)
  })
}

async function sendLongReply(msg: Message, reply: string) {
  if (reply.length <= 2000) {
    await msg.reply(reply)
  } else {
    const chunks = reply.match(/[\s\S]{1,1990}/g) || []
    for (const chunk of chunks) {
      await msg.reply(chunk)
    }
  }
}

function ghIssueView(repo: string, num: number) {
  const raw = execFileSync('gh', [
    'issue', 'view', String(num),
    '--repo', repo,
    '--json', 'title,body,comments,labels',
  ], { encoding: 'utf-8', timeout: 15000 })
  return JSON.parse(raw)
}

function buildPrompt(repo: string, num: number, detail: any): string {
  const comments = (detail.comments || [])
    .map((c: any) => `**${c.author.login}**: ${c.body}`)
    .join('\n\n')

  return `You are working on issue #${num} in ${repo}.

## Issue: ${detail.title}

${detail.body || 'No description provided.'}

${comments ? `## Comments\n\n${comments}` : ''}

## Instructions

1. Read and understand the issue thoroughly.
2. Explore the codebase to understand the relevant code.
3. Implement the fix or feature described in the issue.
4. Make sure the code works — run tests if they exist.
5. Create a new branch, commit your changes (with a clear message referencing #${num}), and open a pull request.
6. The PR title should reference the issue. The PR body should explain what you changed and why.

Do not ask questions — make reasonable decisions and proceed.`
}
