import { Router } from 'express'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import { prisma } from '../prisma.js'
import { invalidateAllCaches, refreshConfig, loadConfig } from '../orchestrator/config.js'
import { updateGitHubSyncInterval } from '../orchestrator/github-sync.js'
import { isRedisConnected } from '../cache.js'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const router = Router()

// GET /api/settings — all settings grouped by category, secrets masked
router.get('/', async (_req, res) => {
  const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } })

  // Group by category
  const grouped: Record<string, any[]> = {}
  for (const row of rows) {
    const setting = {
      key: row.key,
      value: row.type === 'secret' ? (row.value ? '••••••••' : '') : row.value,
      type: row.type,
      label: row.label,
      description: row.description,
      category: row.category,
      updated_at: row.updatedAt.toISOString(),
    }
    if (!grouped[row.category]) grouped[row.category] = []
    grouped[row.category].push(setting)
  }

  res.json(grouped)
})

// PUT /api/settings — bulk update { key: value, ... }
router.put('/', async (req, res) => {
  const updates = req.body as Record<string, string>

  try {
    await prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(updates)) {
        await tx.setting.update({
          where: { key },
          data: { value: String(value) },
        })
      }
    })
  } catch (err: any) {
    if (err.code === 'P2025') {
      res.status(400).json({ ok: false, error: 'Unknown setting key' })
      return
    }
    res.status(500).json({ ok: false, error: err.message })
    return
  }

  // Invalidate config cache and refresh
  invalidateAllCaches()
  const config = await refreshConfig()

  // Reconfigure running services with new settings
  updateGitHubSyncInterval(config.github.pollIntervalMs)

  res.json({ ok: true })
})

// GET /api/settings/system-info — system status overview
router.get('/system-info', async (_req, res) => {
  const pkg = require('../../../package.json')
  const config = loadConfig()

  // Check database connectivity
  let dbOk = false
  try {
    await prisma.$queryRaw`SELECT 1`
    dbOk = true
  } catch { /* db down */ }

  // Disk usage for logs/repos dirs
  function dirSize(dir: string): { files: number; bytes: number } {
    try {
      let files = 0
      let bytes = 0
      for (const entry of readdirSync(dir)) {
        try {
          const st = statSync(join(dir, entry))
          if (st.isFile()) { files++; bytes += st.size }
        } catch { /* skip */ }
      }
      return { files, bytes }
    } catch { return { files: 0, bytes: 0 } }
  }

  const logsDir = config.paths.logs.replace(/^~/, process.env.HOME || '/tmp')
  const reposDir = config.paths.repos.replace(/^~/, process.env.HOME || '/tmp')

  // Node.js memory
  const mem = process.memoryUsage()

  res.json({
    version: `v${pkg.version}`,
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime()),
    pid: process.pid,
    database: dbOk ? 'connected' : 'disconnected',
    redis: isRedisConnected() ? 'connected' : 'disconnected',
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
    },
    disk: {
      logs: dirSize(logsDir),
      repos: dirSize(reposDir),
    },
  })
})

// POST /api/settings/export — export all settings as JSON
router.post('/export', async (_req, res) => {
  const settings = await prisma.setting.findMany({ orderBy: { key: 'asc' } })
  const templates = await prisma.promptTemplate.findMany({ orderBy: { slug: 'asc' } })

  // Mask secrets in export
  const maskedSettings = settings.map(s => ({
    ...s,
    value: s.type === 'secret' ? '' : s.value,
    updatedAt: s.updatedAt.toISOString(),
  }))

  res.json({
    exportedAt: new Date().toISOString(),
    settings: maskedSettings,
    promptTemplates: templates.map(t => ({
      ...t,
      updatedAt: t.updatedAt.toISOString(),
    })),
  })
})

// POST /api/settings/import — import settings from JSON
router.post('/import', async (req, res) => {
  const { settings, promptTemplates } = req.body as {
    settings?: Array<{ key: string; value: string; type: string; label: string; description: string; category: string }>
    promptTemplates?: Array<{ slug: string; name: string; description: string; template: string; maxAttempts: number; timeoutMs: number }>
  }

  let settingsCount = 0
  let templatesCount = 0

  try {
    await prisma.$transaction(async (tx) => {
      if (settings) {
        for (const s of settings) {
          // Skip empty secrets (don't overwrite existing secrets with empty values)
          if (s.type === 'secret' && !s.value) continue
          await tx.setting.upsert({
            where: { key: s.key },
            update: { value: s.value, type: s.type, label: s.label, description: s.description, category: s.category },
            create: { key: s.key, value: s.value, type: s.type, label: s.label, description: s.description, category: s.category },
          })
          settingsCount++
        }
      }
      if (promptTemplates) {
        for (const t of promptTemplates) {
          await tx.promptTemplate.upsert({
            where: { slug: t.slug },
            update: { name: t.name, description: t.description, template: t.template, maxAttempts: t.maxAttempts, timeoutMs: t.timeoutMs },
            create: { slug: t.slug, name: t.name, description: t.description, template: t.template, maxAttempts: t.maxAttempts, timeoutMs: t.timeoutMs },
          })
          templatesCount++
        }
      }
    })

    invalidateAllCaches()
    await refreshConfig()

    res.json({ ok: true, imported: { settings: settingsCount, promptTemplates: templatesCount } })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /api/settings/reset — reset all settings to defaults (re-run seed logic)
router.post('/reset', async (_req, res) => {
  try {
    // Delete all settings and re-seed with defaults
    await prisma.setting.deleteMany()

    // Re-seed inline (same data as seed.ts)
    const defaults = [
      { key: 'github.username', value: 'ultradev', type: 'string', label: 'GitHub Username', description: 'GitHub user to poll for assigned issues', category: 'github' },
      { key: 'github.poll_interval_ms', value: '120000', type: 'number', label: 'Poll Interval (ms)', description: 'How often to sync with GitHub', category: 'github' },
      { key: 'github.auto_assign', value: 'false', type: 'boolean', label: 'Auto-Assign Issues', description: 'Automatically assign synced issues to the configured user', category: 'github' },
      { key: 'github.default_labels', value: '', type: 'string', label: 'Default Labels Filter', description: 'Only sync issues matching these labels (comma-separated, empty = all)', category: 'github' },
      { key: 'github.repos_whitelist', value: '', type: 'string', label: 'Repos Whitelist', description: 'Only sync these repos (comma-separated owner/repo, empty = all)', category: 'github' },
      { key: 'discord.enabled', value: 'true', type: 'boolean', label: 'Enabled', description: 'Enable Discord bot integration', category: 'discord' },
      { key: 'discord.token', value: '', type: 'secret', label: 'Bot Token', description: 'Discord bot token', category: 'discord' },
      { key: 'discord.owner_user_id', value: '', type: 'string', label: 'Owner User ID', description: 'Discord user ID of the bot owner', category: 'discord' },
      { key: 'discord.notify_channel_id', value: '', type: 'string', label: 'Notify Channel ID', description: 'Channel for notifications', category: 'discord' },
      { key: 'discord.trigger_whitelist', value: '', type: 'string', label: 'Trigger Whitelist', description: 'channelId:authorId pairs (comma-separated)', category: 'discord' },
      { key: 'error_watcher.enabled', value: 'true', type: 'boolean', label: 'Error Watcher Enabled', description: 'Enable error watcher', category: 'worker' },
      { key: 'error_watcher.interval_ms', value: '43200000', type: 'number', label: 'Error Watcher Interval (ms)', description: 'How often to scan for errors', category: 'worker' },
      { key: 'error_watcher.target_repo', value: '', type: 'string', label: 'Error Watcher Target Repo', description: 'Repo to create issues in (owner/repo)', category: 'worker' },
      { key: 'error_watcher.labels', value: 'production,bug,auto-triaged', type: 'string', label: 'Error Watcher Labels', description: 'Labels for auto-created issues', category: 'worker' },
      { key: 'worker.max_concurrent', value: '1', type: 'number', label: 'Max Concurrent Workers', description: 'Maximum number of parallel Claude workers', category: 'worker' },
      { key: 'worker.default_timeout_ms', value: '1800000', type: 'number', label: 'Default Timeout (ms)', description: 'Default task timeout (30 min default)', category: 'worker' },
      { key: 'notifications.enabled', value: 'true', type: 'boolean', label: 'Notifications Enabled', description: 'Master toggle for all notifications', category: 'notifications' },
      { key: 'notifications.discord_on_success', value: 'true', type: 'boolean', label: 'Notify on Success', description: 'Send Discord notification when a task completes successfully', category: 'notifications' },
      { key: 'notifications.discord_on_failure', value: 'true', type: 'boolean', label: 'Notify on Failure', description: 'Send Discord notification when a task fails', category: 'notifications' },
      { key: 'paths.repos', value: '~/ultradev/repos', type: 'string', label: 'Repos Directory', description: 'Where to clone repositories', category: 'paths' },
      { key: 'paths.logs', value: '~/ultradev/logs', type: 'string', label: 'Logs Directory', description: 'Where to store worker logs', category: 'paths' },
      { key: 'claude.command', value: 'claude', type: 'string', label: 'Claude Command', description: 'Path to the Claude CLI', category: 'claude' },
      { key: 'claude.flags', value: '--dangerously-skip-permissions', type: 'string', label: 'Claude Flags', description: 'Flags passed to Claude CLI (comma-separated)', category: 'claude' },
      { key: 'log.level', value: 'info', type: 'string', label: 'Log Level', description: 'Log verbosity: debug, info, warn, error', category: 'logging' },
      { key: 'log.retention_days', value: '30', type: 'number', label: 'Log Retention (days)', description: 'Auto-delete logs older than this many days (0 = never)', category: 'logging' },
      { key: 'ui.theme', value: 'dark', type: 'string', label: 'Theme', description: 'UI theme: dark, light, system', category: 'appearance' },
      { key: 'ui.page_size', value: '25', type: 'number', label: 'Default Page Size', description: 'Default number of items per page in tables', category: 'appearance' },
      { key: 'features.auto_pr_review', value: 'true', type: 'boolean', label: 'Auto PR Review', description: 'Automatically address PR review feedback', category: 'features' },
      { key: 'features.self_heal', value: 'true', type: 'boolean', label: 'Self Heal', description: 'Auto-fix system errors when detected', category: 'features' },
      { key: 'features.cron_scheduler', value: 'true', type: 'boolean', label: 'Cron Scheduler', description: 'Enable the cron job scheduler', category: 'features' },
      { key: 'features.auto_merge', value: 'false', type: 'boolean', label: 'Auto Merge', description: 'Auto-merge PRs after all checks pass and approval received', category: 'features' },
    ]

    await prisma.setting.createMany({ data: defaults })

    invalidateAllCaches()
    await refreshConfig()

    res.json({ ok: true, reset: defaults.length })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /api/settings/clear-caches — clear all server-side caches
router.post('/clear-caches', async (_req, res) => {
  invalidateAllCaches()
  res.json({ ok: true })
})

// POST /api/settings/purge-logs — delete log files older than N days
router.post('/purge-logs', async (req, res) => {
  const { olderThanDays } = req.body as { olderThanDays?: number }
  const days = olderThanDays ?? 30
  const config = loadConfig()
  const logsDir = config.paths.logs.replace(/^~/, process.env.HOME || '/tmp')

  let deleted = 0
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

  try {
    for (const entry of readdirSync(logsDir)) {
      const filePath = join(logsDir, entry)
      try {
        const st = statSync(filePath)
        if (st.isFile() && st.mtimeMs < cutoff) {
          unlinkSync(filePath)
          deleted++
        }
      } catch { /* skip */ }
    }
    res.json({ ok: true, deleted })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /api/settings/test-connection — test external service connections
router.post('/test-connection', async (req, res) => {
  const { service } = req.body as { service: string }

  switch (service) {
    case 'github': {
      try {
        const { stdout } = await execFileAsync('gh', ['auth', 'status', '--active'], {
          timeout: 10_000,
          encoding: 'utf-8',
        })
        res.json({ ok: true, message: stdout.trim() })
      } catch (err: any) {
        res.json({ ok: false, message: err.stderr?.trim() || err.message })
      }
      break
    }
    case 'database': {
      try {
        await prisma.$queryRaw`SELECT 1`
        res.json({ ok: true, message: 'PostgreSQL connection OK' })
      } catch (err: any) {
        res.json({ ok: false, message: err.message })
      }
      break
    }
    case 'redis': {
      res.json({
        ok: isRedisConnected(),
        message: isRedisConnected() ? 'Redis connection OK' : 'Redis not connected',
      })
      break
    }
    case 'discord': {
      const config = loadConfig()
      if (!config.discord.token) {
        res.json({ ok: false, message: 'No Discord token configured' })
      } else {
        // Just check if we have a token configured — actual status comes from the bot
        res.json({ ok: config.discord.enabled, message: config.discord.enabled ? 'Discord bot enabled' : 'Discord bot disabled' })
      }
      break
    }
    default:
      res.status(400).json({ ok: false, message: `Unknown service: ${service}` })
  }
})

// POST /api/settings/restart-service — restart a specific service
router.post('/restart-service', async (req, res) => {
  const { service } = req.body as { service: string }

  switch (service) {
    case 'orchestrator': {
      try {
        // Restart via systemd if available, otherwise just refresh config
        try {
          await execFileAsync('systemctl', ['--user', 'restart', 'ultradev'], { timeout: 15_000, encoding: 'utf-8' })
          res.json({ ok: true, message: 'Orchestrator service restarted' })
        } catch {
          // No systemd — just refresh config as fallback
          invalidateAllCaches()
          await refreshConfig()
          res.json({ ok: true, message: 'Config refreshed (no systemd service found)' })
        }
      } catch (err: any) {
        res.status(500).json({ ok: false, message: err.message })
      }
      break
    }
    case 'all': {
      invalidateAllCaches()
      await refreshConfig()
      res.json({ ok: true, message: 'All caches cleared and config refreshed' })
      break
    }
    default:
      res.status(400).json({ ok: false, message: `Unknown service: ${service}` })
  }
})

export default router
