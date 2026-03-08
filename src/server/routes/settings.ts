import { Router } from 'express'
import { prisma } from '../prisma.js'
import { invalidateSettingsCache, refreshConfig } from '../orchestrator/config.js'

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

  for (const [key, value] of Object.entries(updates)) {
    await prisma.setting.update({
      where: { key },
      data: { value: String(value) },
    }).catch(() => {
      // Key doesn't exist — skip
    })
  }

  // Invalidate config cache so next loadConfig() picks up changes
  invalidateSettingsCache()
  await refreshConfig()

  res.json({ ok: true })
})

export default router
