import { join } from 'path'
import { loadSettingsConfig, invalidateSettingsCache } from './settings.js'

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
    autoAssign: boolean
    defaultLabels: string[]
    reposWhitelist: string[]
  }
  discord: {
    enabled: boolean
    token: string | null
    ownerUserId: string | null
    notifyChannelId: string | null
    triggerWhitelist: TriggerRule[]
  }
  errorWatcher: ErrorWatcherConfig
  worker: {
    maxConcurrent: number
    defaultTimeoutMs: number
  }
  notifications: {
    enabled: boolean
    discordOnSuccess: boolean
    discordOnFailure: boolean
  }
  paths: {
    repos: string
    logs: string
  }
  claude: {
    command: string
    flags: string[]
  }
  log: {
    level: string
    retentionDays: number
  }
  ui: {
    theme: string
    pageSize: number
  }
  features: {
    autoPrReview: boolean
    selfHeal: boolean
    cronScheduler: boolean
    autoMerge: boolean
  }
}

/** Cached config — loaded synchronously from the last async fetch. */
let cachedConfig: Config | null = null

function splitCsv(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

function envFallbackConfig(): Config {
  const flags = process.env.ULTRADEV_CLAUDE_FLAGS
    ? process.env.ULTRADEV_CLAUDE_FLAGS.split(',').map(f => f.trim())
    : ['--dangerously-skip-permissions']

  return {
    github: {
      username: process.env.ULTRADEV_GITHUB_USERNAME || 'ultradev',
      pollIntervalMs: parseInt(process.env.ULTRADEV_POLL_INTERVAL_MS || '120000', 10),
      autoAssign: process.env.ULTRADEV_GITHUB_AUTO_ASSIGN === 'true',
      defaultLabels: splitCsv(process.env.ULTRADEV_GITHUB_DEFAULT_LABELS || ''),
      reposWhitelist: splitCsv(process.env.ULTRADEV_GITHUB_REPOS_WHITELIST || ''),
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
      labels: splitCsv(process.env.ULTRADEV_ERROR_WATCHER_LABELS || 'production,bug,auto-triaged'),
    },
    worker: {
      maxConcurrent: parseInt(process.env.ULTRADEV_WORKER_MAX_CONCURRENT || '1', 10),
      defaultTimeoutMs: parseInt(process.env.ULTRADEV_WORKER_DEFAULT_TIMEOUT_MS || '1800000', 10),
    },
    notifications: {
      enabled: process.env.ULTRADEV_NOTIFICATIONS_ENABLED !== 'false',
      discordOnSuccess: process.env.ULTRADEV_NOTIFICATIONS_DISCORD_ON_SUCCESS !== 'false',
      discordOnFailure: process.env.ULTRADEV_NOTIFICATIONS_DISCORD_ON_FAILURE !== 'false',
    },
    paths: {
      repos: process.env.ULTRADEV_REPOS_DIR || join(HOME, 'ultradev', 'repos'),
      logs: process.env.ULTRADEV_LOGS_DIR || join(HOME, 'ultradev', 'logs'),
    },
    claude: {
      command: process.env.ULTRADEV_CLAUDE_COMMAND || 'claude',
      flags,
    },
    log: {
      level: process.env.ULTRADEV_LOG_LEVEL || 'info',
      retentionDays: parseInt(process.env.ULTRADEV_LOG_RETENTION_DAYS || '30', 10),
    },
    ui: {
      theme: process.env.ULTRADEV_UI_THEME || 'dark',
      pageSize: parseInt(process.env.ULTRADEV_UI_PAGE_SIZE || '25', 10),
    },
    features: {
      autoPrReview: process.env.ULTRADEV_FEATURES_AUTO_PR_REVIEW !== 'false',
      selfHeal: process.env.ULTRADEV_FEATURES_SELF_HEAL !== 'false',
      cronScheduler: process.env.ULTRADEV_FEATURES_CRON_SCHEDULER !== 'false',
      autoMerge: process.env.ULTRADEV_FEATURES_AUTO_MERGE === 'true',
    },
  }
}

/**
 * Synchronous loadConfig — returns cached DB config if available, else env fallback.
 * Call refreshConfig() at startup to prime from DB.
 */
export function loadConfig(): Config {
  return cachedConfig ?? envFallbackConfig()
}

/** Async: refresh config from the settings table. Called at startup + after settings save. */
export async function refreshConfig(): Promise<Config> {
  try {
    cachedConfig = await loadSettingsConfig()
  } catch {
    cachedConfig = envFallbackConfig()
  }
  return cachedConfig
}

/** Invalidate config cache — clears both the settings cache and this module's cached config. */
export function invalidateAllCaches() {
  cachedConfig = null
  invalidateSettingsCache()
}

function parseTriggerWhitelist(raw: string): TriggerRule[] {
  if (!raw.trim()) return []
  return raw.split(',').map(entry => {
    const [channelId, authorId] = entry.trim().split(':')
    return { channelId, authorId }
  }).filter(r => r.channelId && r.authorId)
}
