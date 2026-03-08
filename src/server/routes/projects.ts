import { Router } from 'express'
import { prisma } from '../prisma.js'
import { toSnakeCase } from '../lib/case.js'
import type { ProjectStatus } from '@prisma/client'

const router = Router()

function projectWithCronjobIds(project: any) {
  const { projectCronjobs, ...rest } = project
  return {
    ...toSnakeCase(rest),
    cronjob_ids: (projectCronjobs || []).map((pc: any) => pc.cronjobId),
  }
}

router.get('/', async (_req, res) => {
  const rows = await prisma.project.findMany({
    include: { projectCronjobs: true },
    orderBy: { createdAt: 'desc' },
  })
  res.json(rows.map(projectWithCronjobIds))
})

router.get('/:id', async (req, res) => {
  const row = await prisma.project.findUnique({
    where: { id: parseInt(req.params.id) },
    include: { projectCronjobs: true },
  })
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(projectWithCronjobIds(row))
})

router.post('/', async (req, res) => {
  const { name, repo_url, description, status, cronjob_ids } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  const result = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name,
        repoUrl: repo_url || '',
        description: description || '',
        status: (status || 'active') as ProjectStatus,
      },
    })
    if (Array.isArray(cronjob_ids) && cronjob_ids.length > 0) {
      await tx.projectCronjob.createMany({
        data: cronjob_ids.map((cid: number) => ({
          projectId: project.id,
          cronjobId: cid,
        })),
      })
    }
    return { ...toSnakeCase(project), cronjob_ids: cronjob_ids || [] }
  })

  res.status(201).json(result)
})

router.put('/:id', async (req, res) => {
  const { name, repo_url, description, status, cronjob_ids } = req.body
  const id = parseInt(req.params.id)

  try {
    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(repo_url !== undefined && { repoUrl: repo_url }),
          ...(description !== undefined && { description }),
          ...(status !== undefined && { status: status as ProjectStatus }),
        },
      })
      if (Array.isArray(cronjob_ids)) {
        await tx.projectCronjob.deleteMany({ where: { projectId: id } })
        if (cronjob_ids.length > 0) {
          await tx.projectCronjob.createMany({
            data: cronjob_ids.map((cid: number) => ({
              projectId: id,
              cronjobId: cid,
            })),
          })
        }
      }
      const fresh = await tx.project.findUnique({
        where: { id },
        include: { projectCronjobs: true },
      })
      return projectWithCronjobIds(fresh)
    })
    res.json(result)
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' })
    throw err
  }
})

router.delete('/:id', async (req, res) => {
  await prisma.project.delete({ where: { id: parseInt(req.params.id) } }).catch(() => {})
  res.json({ ok: true })
})

export default router
