import { Router } from 'express'
import { prisma } from '../prisma.js'
import { invalidateTemplateCache } from '../orchestrator/prompt-loader.js'

const router = Router()

// GET /api/prompt-templates — list all
router.get('/', async (_req, res) => {
  const rows = await prisma.promptTemplate.findMany({ orderBy: { slug: 'asc' } })
  res.json(rows.map(r => ({
    slug: r.slug,
    name: r.name,
    description: r.description,
    template: r.template,
    max_attempts: r.maxAttempts,
    timeout_ms: r.timeoutMs,
    updated_at: r.updatedAt.toISOString(),
  })))
})

// GET /api/prompt-templates/:slug — get one
router.get('/:slug', async (req, res) => {
  const row = await prisma.promptTemplate.findUnique({ where: { slug: req.params.slug } })
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json({
    slug: row.slug,
    name: row.name,
    description: row.description,
    template: row.template,
    max_attempts: row.maxAttempts,
    timeout_ms: row.timeoutMs,
    updated_at: row.updatedAt.toISOString(),
  })
})

// PUT /api/prompt-templates/:slug — update
router.put('/:slug', async (req, res) => {
  const { template, max_attempts, timeout_ms, name, description } = req.body
  try {
    const row = await prisma.promptTemplate.update({
      where: { slug: req.params.slug },
      data: {
        ...(template !== undefined && { template }),
        ...(max_attempts !== undefined && { maxAttempts: max_attempts }),
        ...(timeout_ms !== undefined && { timeoutMs: timeout_ms }),
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
      },
    })
    invalidateTemplateCache()
    res.json({
      slug: row.slug,
      name: row.name,
      description: row.description,
      template: row.template,
      max_attempts: row.maxAttempts,
      timeout_ms: row.timeoutMs,
      updated_at: row.updatedAt.toISOString(),
    })
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' })
    throw err
  }
})

// POST /api/prompt-templates/:slug/reset — reset to seed default
// This re-runs the seed logic for a single template
router.post('/:slug/reset', async (req, res) => {
  // We'll delete and let the user re-seed, or we store defaults
  // For now, just return the current state — the seed script has the defaults
  // A proper reset would need the seed data accessible at runtime
  res.status(501).json({ error: 'Use `pnpm prisma db seed` to reset all templates to defaults' })
})

export default router
