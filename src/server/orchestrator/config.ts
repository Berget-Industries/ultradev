import { join } from 'path'

const HOME = process.env.HOME || '/home/' + (process.env.USER || 'user')

export interface TriggerRule {
  channelId: string
  authorId: string
}

export interface ErrorWatcherConfig {
  enabled: boolean
  intervalMs: number
  targetRepo: string | null
  labels: string[]
}

export interface Config {
  github: {
    username: string
    pollIntervalMs: number
  }
  discord: {
    enabled: boolean
    token: string | null
    ownerUserId: string | null
    notifyChannelId: string | null
    triggerWhitelist: TriggerRule[]
  }
  errorWatcher: ErrorWatcherConfig
  paths: {
    repos: string
    logs: string
  }
  claude: {
    command: string
    flags: string[]
  }
}

export function loadConfig(): Config {
  const flags = process.env.ULTRADEV_CLAUDE_FLAGS
    ? process.env.ULTRADEV_CLAUDE_FLAGS.split(',').map(f => f.trim())
    : ['--dangerously-skip-permissions']

  return {
    github: {
      username: process.env.ULTRADEV_GITHUB_USERNAME || 'ultradev',
      pollIntervalMs: parseInt(process.env.ULTRADEV_POLL_INTERVAL_MS || '120000', 10),
    },
    discord: {
      enabled: process.env.ULTRADEV_DISCORD_ENABLED !== 'false',
      token: process.env.ULTRADEV_DISCORD_TOKEN || null,
      ownerUserId: process.env.ULTRADEV_DISCORD_OWNER_USER_ID || null,
      notifyChannelId: process.env.ULTRADEV_DISCORD_NOTIFY_CHANNEL_ID || null,
      triggerWhitelist: parseTriggerWhitelist(process.env.ULTRADEV_DISCORD_TRIGGER_WHITELIST || ''),
    },
    errorWatcher: {
      enabled: process.env.ULTRADEV_ERROR_WATCHER_ENABLED !== 'false',
      intervalMs: parseInt(process.env.ULTRADEV_ERROR_WATCHER_INTERVAL_MS || String(12 * 60 * 60 * 1000), 10),
      targetRepo: process.env.ULTRADEV_ERROR_WATCHER_REPO || null,
      labels: (process.env.ULTRADEV_ERROR_WATCHER_LABELS || 'production,bug,auto-triaged').split(',').map(l => l.trim()).filter(Boolean),
    },
    paths: {
      repos: process.env.ULTRADEV_REPOS_DIR || join(HOME, 'ultradev', 'repos'),
      logs: process.env.ULTRADEV_LOGS_DIR || join(HOME, 'ultradev', 'logs'),
    },
    claude: {
      command: process.env.ULTRADEV_CLAUDE_COMMAND || 'claude',
      flags,
    },
  }
}

// Parse "channelId:authorId,channelId:authorId" into TriggerRule[]
function parseTriggerWhitelist(raw: string): TriggerRule[] {
  if (!raw.trim()) return []
  return raw.split(',').map(entry => {
    const [channelId, authorId] = entry.trim().split(':')
    return { channelId, authorId }
  }).filter(r => r.channelId && r.authorId)
}

// Runtime override for poll interval (used by dashboard API)
let runtimePollIntervalMs: number | null = null

export function setRuntimePollInterval(ms: number) {
  runtimePollIntervalMs = ms
}

export function getRuntimePollInterval(): number | null {
  return runtimePollIntervalMs
}
