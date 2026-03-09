import { prisma } from '../prisma.js'
import type { Config, TriggerRule } from './config.js'
import { join } from 'path'

const HOME = process.env.HOME || '/home/' + (process.env.USER || 'user')

let cache: { config: Config; ts: number } | null = null
const CACHE_TTL = 10_000

export function invalidateSettingsCache() {
  cache = null
}

export async function loadSettingsConfig(): Promise<Config> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.config

  const rows = await prisma.setting.findMany()
  const map = new Map(rows.map(r => [r.key, r.value]))

  function get(key: string, fallbackEnv: string | undefined, defaultVal: string): string {
    if (map.has(key)) return map.get(key)!
    return fallbackEnv || defaultVal
  }

  const flags = get('claude.flags', process.env.ULTRADEV_CLAUDE_FLAGS, '--dangerously-skip-permissions')
    .split(',').map(f => f.trim()).filter(Boolean)

  const config: Config = {
    github: {
      username: get('github.username', process.env.ULTRADEV_GITHUB_USERNAME, 'ultradev'),
      pollIntervalMs: safeParseInt(get('github.poll_interval_ms', process.env.ULTRADEV_POLL_INTERVAL_MS, '120000'), 120000),
    },
    discord: {
      enabled: get('discord.enabled', process.env.ULTRADEV_DISCORD_ENABLED, 'true') !== 'false',
      token: get('discord.token', process.env.ULTRADEV_DISCORD_TOKEN, '') || null,
      ownerUserId: get('discord.owner_user_id', process.env.ULTRADEV_DISCORD_OWNER_USER_ID, '') || null,
      notifyChannelId: get('discord.notify_channel_id', process.env.ULTRADEV_DISCORD_NOTIFY_CHANNEL_ID, '') || null,
      triggerWhitelist: parseTriggerWhitelist(
        get('discord.trigger_whitelist', process.env.ULTRADEV_DISCORD_TRIGGER_WHITELIST, '')
      ),
    },
    errorWatcher: {
      enabled: get('error_watcher.enabled', process.env.ULTRADEV_ERROR_WATCHER_ENABLED, 'true') !== 'false',
      intervalMs: safeParseInt(get('error_watcher.interval_ms', process.env.ULTRADEV_ERROR_WATCHER_INTERVAL_MS, String(12 * 60 * 60 * 1000)), 12 * 60 * 60 * 1000),
      targetRepo: get('error_watcher.target_repo', process.env.ULTRADEV_ERROR_WATCHER_REPO, '') || null,
      labels: get('error_watcher.labels', process.env.ULTRADEV_ERROR_WATCHER_LABELS, 'production,bug,auto-triaged')
        .split(',').map(l => l.trim()).filter(Boolean),
    },
    paths: {
      repos: get('paths.repos', process.env.ULTRADEV_REPOS_DIR, join(HOME, 'ultradev', 'repos')),
      logs: get('paths.logs', process.env.ULTRADEV_LOGS_DIR, join(HOME, 'ultradev', 'logs')),
    },
    claude: {
      command: get('claude.command', process.env.ULTRADEV_CLAUDE_COMMAND, 'claude'),
      flags,
    },
  }

  cache = { config, ts: Date.now() }
  return config
}

function safeParseInt(val: string, fallback: number): number {
  const parsed = parseInt(val, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function parseTriggerWhitelist(raw: string): TriggerRule[] {
  if (!raw.trim()) return []
  return raw.split(',').map(entry => {
    const [channelId, authorId] = entry.trim().split(':')
    return { channelId, authorId }
  }).filter(r => r.channelId && r.authorId)
}
