import { Router } from 'express'
import { prisma } from '../prisma.js'
import { toSnakeCase } from '../lib/case.js'
import type { CronjobStatus } from '@prisma/client'

const router = Router()

const VALID_STATUSES: CronjobStatus[] = ['active', 'paused', 'disabled'] as CronjobStatus[]

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  return parseInt(raw, 10)
}

class DateValidationError extends Error {
  constructor(field: string) { super(`Invalid ${field} date`); this.name = 'DateValidationError' }
}

function parseDateField(raw: unknown, field: string): Date | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  const d = new Date(raw as string)
  if (isNaN(d.getTime())) throw new DateValidationError(field)
  return d
}

router.get('/', async (_req, res) => {
  const rows = await prisma.cronjob.findMany({ orderBy: { createdAt: 'desc' } })
  res.json(toSnakeCase(rows))
})

router.post('/', async (req, res) => {
  const { name, schedule, description, command, status } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const resolvedStatus = (status || 'active') as string
  if (!VALID_STATUSES.includes(resolvedStatus as CronjobStatus)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` })
  }
  const row = await prisma.cronjob.create({
    data: {
      name,
      schedule: schedule || '* * * * *',
      description: description || '',
      command: command || '',
      status: resolvedStatus as CronjobStatus,
    },
  })
  res.status(201).json(toSnakeCase(row))
})

router.put('/:id', async (req, res) => {
  const { name, schedule, description, command, status, last_run, next_run } = req.body
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })
  if (status !== undefined && !VALID_STATUSES.includes(status as CronjobStatus)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` })
  }
  let parsedLastRun: Date | null | undefined
  let parsedNextRun: Date | null | undefined
  try {
    parsedLastRun = parseDateField(last_run, 'last_run')
    parsedNextRun = parseDateField(next_run, 'next_run')
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid date' })
  }
  try {
    const row = await prisma.cronjob.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(schedule !== undefined && { schedule }),
        ...(description !== undefined && { description }),
        ...(command !== undefined && { command }),
        ...(status !== undefined && { status: status as CronjobStatus }),
        ...(parsedLastRun !== undefined && { lastRun: parsedLastRun }),
        ...(parsedNextRun !== undefined && { nextRun: parsedNextRun }),
      },
    })
    res.json(toSnakeCase(row))
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' })
    throw err
  }
})

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'Invalid id' })
  try {
    await prisma.cronjob.delete({ where: { id } })
  } catch (err: any) {
    if (err.code !== 'P2025') throw err
  }
  res.json({ ok: true })
})

export default router
