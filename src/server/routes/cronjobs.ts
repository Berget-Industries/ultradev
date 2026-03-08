import { Router } from 'express'
import { prisma } from '../prisma.js'
import { toSnakeCase } from '../lib/case.js'
import type { CronjobStatus } from '@prisma/client'

const router = Router()

router.get('/', async (_req, res) => {
  const rows = await prisma.cronjob.findMany({ orderBy: { createdAt: 'desc' } })
  res.json(toSnakeCase(rows))
})

router.post('/', async (req, res) => {
  const { name, schedule, description, command, status } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const row = await prisma.cronjob.create({
    data: {
      name,
      schedule: schedule || '* * * * *',
      description: description || '',
      command: command || '',
      status: (status || 'active') as CronjobStatus,
    },
  })
  res.status(201).json(toSnakeCase(row))
})

router.put('/:id', async (req, res) => {
  const { name, schedule, description, command, status, last_run, next_run } = req.body
  const id = parseInt(req.params.id)
  try {
    const row = await prisma.cronjob.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(schedule !== undefined && { schedule }),
        ...(description !== undefined && { description }),
        ...(command !== undefined && { command }),
        ...(status !== undefined && { status: status as CronjobStatus }),
        ...(last_run !== undefined && { lastRun: new Date(last_run) }),
        ...(next_run !== undefined && { nextRun: new Date(next_run) }),
      },
    })
    res.json(toSnakeCase(row))
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' })
    throw err
  }
})

router.delete('/:id', async (req, res) => {
  await prisma.cronjob.delete({ where: { id: parseInt(req.params.id) } }).catch(() => {})
  res.json({ ok: true })
})

export default router
