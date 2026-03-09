import { Router } from 'express'
import { prisma } from '../prisma.js'
import { invalidateAllCaches, refreshConfig, loadConfig } from '../orchestrator/config.js'
import { updateGitHubSyncInterval } from '../orchestrator/github-sync.js'

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
  const errors: string[] = []

  for (const [key, value] of Object.entries(updates)) {
    try {
      await prisma.setting.update({
        where: { key },
        data: { value: String(value) },
      })
    } catch (err: any) {
      if (err.code === 'P2025') continue // Key doesn't exist — skip
      errors.push(`${key}: ${err.message}`)
    }
  }

  if (errors.length > 0) {
    res.status(500).json({ ok: false, errors })
    return
  }

  // Invalidate config cache and refresh
  invalidateAllCaches()
  const config = await refreshConfig()

  // Reconfigure running services with new settings
  updateGitHubSyncInterval(config.github.pollIntervalMs)

  res.json({ ok: true })
})

export default router
