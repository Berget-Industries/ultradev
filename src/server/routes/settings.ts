import { Router } from 'express'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readdirSync, statSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import { createRequire } from 'module'
import { prisma } from '../prisma.js'
import { invalidateAllCaches, refreshConfig, loadConfig } from '../orchestrator/config.js'
import { updateGitHubSyncInterval } from '../orchestrator/github-sync.js'
import { isRedisConnected } from '../cache.js'
import { expandTilde } from '../lib/config-helpers.js'
import { defaultSettings } from '../lib/defaults.js'

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

  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    res.status(400).json({ ok: false, error: 'Body must be a JSON object' })
    return
  }

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
    res.status(500).json({ ok: false, error: 'Failed to save settings' })
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

  const logsDir = expandTilde(config.paths.logs)
  const reposDir = expandTilde(config.paths.repos)

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

// GET /api/settings/export — export all settings as JSON
router.get('/export', async (_req, res) => {
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

  // Validate that imported setting keys are known
  const validKeys = new Set(defaultSettings.map(s => s.key))

  let settingsCount = 0
  let templatesCount = 0

  try {
    await prisma.$transaction(async (tx) => {
      if (settings) {
        for (const s of settings) {
          // Skip empty secrets (don't overwrite existing secrets with empty values)
          if (s.type === 'secret' && !s.value) continue
          // Only allow known setting keys
          if (!validKeys.has(s.key)) continue
          await tx.setting.upsert({
            where: { key: s.key },
            update: { value: s.value },
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
  } catch {
    res.status(500).json({ ok: false, error: 'Failed to import settings' })
  }
})

// POST /api/settings/reset — reset all settings to defaults
router.post('/reset', async (_req, res) => {
  try {
    await prisma.setting.deleteMany()
    await prisma.setting.createMany({ data: defaultSettings })

    invalidateAllCaches()
    await refreshConfig()

    res.json({ ok: true, reset: defaultSettings.length })
  } catch {
    res.status(500).json({ ok: false, error: 'Failed to reset settings' })
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

  if (typeof days !== 'number' || !Number.isFinite(days) || days < 1) {
    res.status(400).json({ ok: false, error: 'olderThanDays must be a positive number (>= 1)' })
    return
  }

  const config = loadConfig()
  const logsDir = resolve(expandTilde(config.paths.logs))

  // Safety: only allow purging inside the configured logs directory
  const homeDir = process.env.HOME || '/tmp'
  if (!logsDir.startsWith(homeDir)) {
    res.status(400).json({ ok: false, error: 'Logs directory must be within the home directory' })
    return
  }

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
  } catch {
    res.status(500).json({ ok: false, error: 'Failed to purge logs' })
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
        res.json({ ok: false, message: err.stderr?.trim() || 'GitHub auth check failed' })
      }
      break
    }
    case 'database': {
      try {
        await prisma.$queryRaw`SELECT 1`
        res.json({ ok: true, message: 'PostgreSQL connection OK' })
      } catch {
        res.json({ ok: false, message: 'PostgreSQL connection failed' })
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
        await execFileAsync('systemctl', ['--user', 'restart', 'ultradev'], { timeout: 15_000, encoding: 'utf-8' })
        res.json({ ok: true, message: 'Orchestrator service restarted' })
      } catch {
        // No systemd — just refresh config as fallback
        invalidateAllCaches()
        await refreshConfig()
        res.json({ ok: true, message: 'Config refreshed (no systemd service found)' })
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
