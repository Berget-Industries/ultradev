import { Router } from 'express'
import { prisma } from '../prisma.js'
import { toSnakeCase } from '../lib/case.js'
import type { ProjectStatus, Project, ProjectCronjob } from '@prisma/client'

const router = Router()

const VALID_PROJECT_STATUSES = ['active', 'paused', 'archived'] as const

type ProjectWithCronjobs = Project & { projectCronjobs: ProjectCronjob[] }

function projectWithCronjobIds(project: ProjectWithCronjobs) {
  const { projectCronjobs, ...rest } = project
  return {
    ...toSnakeCase(rest),
    cronjob_ids: projectCronjobs.map((pc) => pc.cronjobId),
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
  const { name, repo_url, description, status, cronjob_ids,
    worker_timeout_ms, default_labels, max_attempts, notify_on_success, notify_on_failure,
    error_watcher_enabled, error_watcher_channel, error_watcher_labels } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  const result = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name,
        repoUrl: repo_url || '',
        description: description || '',
        status: (VALID_PROJECT_STATUSES as readonly string[]).includes(status) ? status as ProjectStatus : 'active',
        workerTimeoutMs: worker_timeout_ms ?? null,
        defaultLabels: default_labels ?? null,
        maxAttempts: max_attempts ?? null,
        notifyOnSuccess: notify_on_success ?? null,
        notifyOnFailure: notify_on_failure ?? null,
        errorWatcherEnabled: error_watcher_enabled ?? false,
        errorWatcherChannel: error_watcher_channel ?? null,
        errorWatcherLabels: error_watcher_labels ?? null,
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
  const { name, repo_url, description, status, cronjob_ids,
    worker_timeout_ms, default_labels, max_attempts, notify_on_success, notify_on_failure,
    error_watcher_enabled, error_watcher_channel, error_watcher_labels } = req.body
  const id = parseInt(req.params.id)

  try {
    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(repo_url !== undefined && { repoUrl: repo_url }),
          ...(description !== undefined && { description }),
          ...(status !== undefined && (VALID_PROJECT_STATUSES as readonly string[]).includes(status) && { status: status as ProjectStatus }),
          ...(worker_timeout_ms !== undefined && { workerTimeoutMs: worker_timeout_ms }),
          ...(default_labels !== undefined && { defaultLabels: default_labels }),
          ...(max_attempts !== undefined && { maxAttempts: max_attempts }),
          ...(notify_on_success !== undefined && { notifyOnSuccess: notify_on_success }),
          ...(notify_on_failure !== undefined && { notifyOnFailure: notify_on_failure }),
          ...(error_watcher_enabled !== undefined && { errorWatcherEnabled: error_watcher_enabled }),
          ...(error_watcher_channel !== undefined && { errorWatcherChannel: error_watcher_channel }),
          ...(error_watcher_labels !== undefined && { errorWatcherLabels: error_watcher_labels }),
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
      if (!fresh) throw Object.assign(new Error('Not found'), { code: 'P2025' })
      return projectWithCronjobIds(fresh)
    })
    res.json(result)
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' })
    throw err
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await prisma.project.delete({ where: { id: parseInt(req.params.id) } })
  } catch (err: any) {
    if (err.code !== 'P2025') throw err
  }
  res.json({ ok: true })
})

export default router
