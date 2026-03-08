import { Router } from 'express'
import { prisma } from '../prisma.js'
import { toSnakeCase } from '../lib/case.js'
import type { Prisma, TaskColumn } from '@prisma/client'

const router = Router()

const validColumns = new Set(['backlog', 'assigned', 'working', 'pr', 'merged'])

router.get('/', async (req, res) => {
  const { project_id, column_id } = req.query
  const where: Prisma.TaskWhereInput = {}
  if (project_id) where.projectId = parseInt(project_id as string)
  if (column_id && validColumns.has(column_id as string)) where.columnId = column_id as TaskColumn

  const rows = await prisma.task.findMany({
    where,
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })
  res.json(toSnakeCase(rows))
})

router.post('/', async (req, res) => {
  const { title, description, column_id, github_url, project_id } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })

  const col = (column_id || 'backlog') as TaskColumn
  const agg = await prisma.task.aggregate({
    where: { columnId: col },
    _max: { position: true },
  })
  const position = (agg._max.position ?? 0) + 1

  const row = await prisma.task.create({
    data: {
      title,
      description: description || '',
      columnId: col,
      position,
      githubUrl: github_url || '',
      projectId: project_id || null,
    },
  })
  res.status(201).json(toSnakeCase(row))
})

router.put('/:id', async (req, res) => {
  const { title, description, github_url, project_id } = req.body
  try {
    const row = await prisma.task.update({
      where: { id: parseInt(req.params.id) },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(github_url !== undefined && { githubUrl: github_url }),
        ...(project_id !== undefined && { projectId: project_id }),
      },
    })
    res.json(toSnakeCase(row))
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' })
    throw err
  }
})

router.put('/:id/move', async (req, res) => {
  const { column_id, position } = req.body
  if (!column_id || position === undefined) {
    return res.status(400).json({ error: 'column_id and position are required' })
  }
  try {
    const row = await prisma.task.update({
      where: { id: parseInt(req.params.id) },
      data: { columnId: column_id as TaskColumn, position },
    })
    res.json(toSnakeCase(row))
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' })
    throw err
  }
})

router.delete('/:id', async (req, res) => {
  await prisma.task.delete({ where: { id: parseInt(req.params.id) } }).catch(() => {})
  res.json({ ok: true })
})

export default router
