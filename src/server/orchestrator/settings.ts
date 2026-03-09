import { prisma } from '../prisma.js'
import type { Config } from './config.js'
import { join } from 'path'
import { HOME, splitCsv, parseTriggerWhitelist, safeParseInt, expandTilde } from '../lib/config-helpers.js'

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
      autoAssign: get('github.auto_assign', process.env.ULTRADEV_GITHUB_AUTO_ASSIGN, 'false') === 'true',
      defaultLabels: splitCsv(get('github.default_labels', process.env.ULTRADEV_GITHUB_DEFAULT_LABELS, '')),
    },
    discord: {
      enabled: get('discord.enabled', process.env.ULTRADEV_DISCORD_ENABLED, 'true') !== 'false',
      token: get('discord.token', process.env.ULTRADEV_DISCORD_TOKEN, '') || null,
      ownerUserId: get('discord.owner_user_id', process.env.ULTRADEV_DISCORD_OWNER_USER_ID, '') || null,
      triggerWhitelist: parseTriggerWhitelist(
        get('discord.trigger_whitelist', process.env.ULTRADEV_DISCORD_TRIGGER_WHITELIST, '')
      ),
    },
    errorWatcher: {
      enabled: get('error_watcher.enabled', process.env.ULTRADEV_ERROR_WATCHER_ENABLED, 'true') !== 'false',
      intervalMs: safeParseInt(get('error_watcher.interval_ms', process.env.ULTRADEV_ERROR_WATCHER_INTERVAL_MS, String(12 * 60 * 60 * 1000)), 12 * 60 * 60 * 1000),
      targetRepo: get('error_watcher.target_repo', process.env.ULTRADEV_ERROR_WATCHER_REPO, '') || null,
      labels: splitCsv(get('error_watcher.labels', process.env.ULTRADEV_ERROR_WATCHER_LABELS, 'production,bug,auto-triaged')),
    },
    worker: {
      maxConcurrent: safeParseInt(get('worker.max_concurrent', process.env.ULTRADEV_WORKER_MAX_CONCURRENT, '1'), 1),
      defaultTimeoutMs: safeParseInt(get('worker.default_timeout_ms', process.env.ULTRADEV_WORKER_DEFAULT_TIMEOUT_MS, '1800000'), 1800000),
    },
    notifications: {
      enabled: get('discord.notifications_enabled', process.env.ULTRADEV_NOTIFICATIONS_ENABLED, 'true') !== 'false',
      discordOnSuccess: get('discord.notify_on_success', process.env.ULTRADEV_NOTIFICATIONS_DISCORD_ON_SUCCESS, 'true') !== 'false',
      discordOnFailure: get('discord.notify_on_failure', process.env.ULTRADEV_NOTIFICATIONS_DISCORD_ON_FAILURE, 'true') !== 'false',
    },
    paths: {
      repos: expandTilde(get('paths.repos', process.env.ULTRADEV_REPOS_DIR, join(HOME, 'ultradev', 'repos'))),
      logs: expandTilde(get('paths.logs', process.env.ULTRADEV_LOGS_DIR, join(HOME, 'ultradev', 'logs'))),
    },
    claude: {
      command: get('claude.command', process.env.ULTRADEV_CLAUDE_COMMAND, 'claude'),
      flags,
    },
    log: {
      level: get('log.level', process.env.ULTRADEV_LOG_LEVEL, 'info'),
      retentionDays: safeParseInt(get('log.retention_days', process.env.ULTRADEV_LOG_RETENTION_DAYS, '30'), 30),
    },
    ui: {
      theme: get('ui.theme', process.env.ULTRADEV_UI_THEME, 'dark'),
      pageSize: safeParseInt(get('ui.page_size', process.env.ULTRADEV_UI_PAGE_SIZE, '25'), 25),
    },
    features: {
      autoPrReview: get('features.auto_pr_review', process.env.ULTRADEV_FEATURES_AUTO_PR_REVIEW, 'true') !== 'false',
      selfHeal: get('features.self_heal', process.env.ULTRADEV_FEATURES_SELF_HEAL, 'true') !== 'false',
      cronScheduler: get('features.cron_scheduler', process.env.ULTRADEV_FEATURES_CRON_SCHEDULER, 'true') !== 'false',
      autoMerge: get('features.auto_merge', process.env.ULTRADEV_FEATURES_AUTO_MERGE, 'false') === 'true',
    },
  }

  cache = { config, ts: Date.now() }
  return config
}
