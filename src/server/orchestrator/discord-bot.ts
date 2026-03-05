import { Client, GatewayIntentBits } from 'discord.js'
import { execFileSync, spawn } from 'child_process'
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { loadConfig } from './config.js'
import { setDiscordClient, notify } from './notifier.js'
import { spawnWorker } from './worker.js'
import { getAllIssues } from './state.js'
import { tryHeal } from './self-heal.js'

let client: Client | null = null
let botStatus: 'offline' | 'online' | 'error' = 'offline'

export function getDiscordBotStatus() {
  return botStatus
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
    ],
  })

  client.once('clientReady', () => {
    console.log(`[discord] Bot online as ${client!.user!.tag}`)
    botStatus = 'online'
    if (config.discord.channelId) {
      setDiscordClient(client!, config.discord.channelId)
      notify('🟢 UltraDev online. Watching for issues.')
    }
  })

  client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return
    if (config.discord.channelId && msg.channel.id !== config.discord.channelId) return

    const content = msg.content.trim()

    if (content === '!status') {
      const issues = getAllIssues()
      const inProgress = Object.entries(issues).filter(([, v]) => v.status === 'in_progress')
      const done = Object.entries(issues).filter(([, v]) => v.status === 'done')
      const failed = Object.entries(issues).filter(([, v]) => v.status === 'failed')
      let reply = '🟢 Online. Polling GitHub for assigned issues.\n'
      if (inProgress.length) reply += `⚙️ In progress: ${inProgress.map(([k]) => k).join(', ')}\n`
      if (done.length) reply += `✅ Done: ${done.map(([k]) => k).join(', ')}\n`
      if (failed.length) reply += `❌ Failed: ${failed.map(([k]) => k).join(', ')}\n`
      await msg.reply(reply)
      return
    }

    if (content === '!ping') {
      await msg.reply('pong 🏓')
      return
    }

    if (content === '!help') {
      await msg.reply(`**UltraDev Commands:**
• \`!ping\` — health check
• \`!status\` — show current work status
• \`!work owner/repo#123\` — work on a specific issue
• \`!repos\` — list cloned repos
• \`!help\` — this message
• Or just talk to me — mention me or just type and I'll respond`)
      return
    }

    const workMatch = content.match(/^!work\s+([\w-]+\/[\w.-]+)#(\d+)$/)
    if (workMatch) {
      const repo = workMatch[1]
      const num = parseInt(workMatch[2])
      await msg.reply(`⚙️ On it — working on ${repo}#${num}...`)

      try {
        const detail = ghIssueView(repo, num)
        const prompt = buildPrompt(repo, num, detail)
        const result = await spawnWorker(repo, prompt, config)

        if (result.success && result.prUrl) {
          await msg.reply(`✅ Done! PR: ${result.prUrl}`)
        } else if (result.success) {
          await msg.reply(`✅ Done, but no PR URL found. Check logs.`)
        } else {
          await msg.reply(`❌ Failed: ${result.error}`)
        }
      } catch (err: any) {
        await msg.reply(`❌ Error: ${err.message}`)
      }
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
      await msg.reply(repos.length ? `📁 Repos:\n${repos.map(r => `• ${r}`).join('\n')}` : 'No repos cloned yet.')
      return
    }

    if (content.startsWith('!')) return

    const mentioned = msg.mentions.has(client!.user!)
    const cleanContent = content.replace(/<@!?\d+>/g, '').trim()

    if (!mentioned && config.discord.channelId) {
      // In the configured channel, respond to everything
    }

    if (!cleanContent) return

    await msg.channel.sendTyping()

    try {
      const reply = await chatWithClaude(cleanContent, msg.author.username)
      if (reply.length <= 2000) {
        await msg.reply(reply)
      } else {
        const chunks = reply.match(/[\s\S]{1,1990}/g) || []
        for (const chunk of chunks) {
          await msg.reply(chunk)
        }
      }
    } catch (err: any) {
      console.error('[discord] Chat error:', err.message)
      await msg.reply(`Hit an error, looking into it: \`${err.message}\``)
      tryHeal('discord-chat', err.message, { file: 'src/discord-bot.js', extra: `User message: "${cleanContent}"` })
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

function chatWithClaude(message: string, username: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const config = loadConfig()
    const child = spawn(config.claude.command, [
      ...config.claude.flags,
      '--print',
      `You are UltraDev, an autonomous AI developer bot on Discord. You're talking to ${username}. Be concise, helpful, and direct. No fluff.\n\n${message}`,
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
