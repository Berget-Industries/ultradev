import { Router } from 'express'
import db from '../db.js'

const router = Router()

router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT p.*, GROUP_CONCAT(pc.cronjob_id) as cronjob_ids
    FROM projects p
    LEFT JOIN project_cronjobs pc ON pc.project_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all() as any[]
  const result = rows.map(r => ({
    ...r,
    cronjob_ids: r.cronjob_ids ? r.cronjob_ids.split(',').map(Number) : [],
  }))
  res.json(result)
})

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Not found' })
  const cronjobIds = db.prepare('SELECT cronjob_id FROM project_cronjobs WHERE project_id = ?')
    .all(req.params.id)
    .map((r: any) => r.cronjob_id)
  res.json({ ...row, cronjob_ids: cronjobIds })
})

router.post('/', (req, res) => {
  const { name, repo_url, description, status, cronjob_ids } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const result = db.prepare(
    'INSERT INTO projects (name, repo_url, description, status) VALUES (?, ?, ?, ?)'
  ).run(name, repo_url || '', description || '', status || 'active')
  const projectId = result.lastInsertRowid
  if (Array.isArray(cronjob_ids)) {
    const insert = db.prepare('INSERT INTO project_cronjobs (project_id, cronjob_id) VALUES (?, ?)')
    for (const cid of cronjob_ids) insert.run(projectId, cid)
  }
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any
  res.status(201).json({ ...row, cronjob_ids: cronjob_ids || [] })
})

router.put('/:id', (req, res) => {
  const { name, repo_url, description, status, cronjob_ids } = req.body
  db.prepare(
    `UPDATE projects SET name = COALESCE(?, name), repo_url = COALESCE(?, repo_url),
     description = COALESCE(?, description), status = COALESCE(?, status),
     updated_at = datetime('now') WHERE id = ?`
  ).run(name, repo_url, description, status, req.params.id)
  if (Array.isArray(cronjob_ids)) {
    db.prepare('DELETE FROM project_cronjobs WHERE project_id = ?').run(req.params.id)
    const insert = db.prepare('INSERT INTO project_cronjobs (project_id, cronjob_id) VALUES (?, ?)')
    for (const cid of cronjob_ids) insert.run(req.params.id, cid)
  }
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Not found' })
  const ids = db.prepare('SELECT cronjob_id FROM project_cronjobs WHERE project_id = ?')
    .all(req.params.id)
    .map((r: any) => r.cronjob_id)
  res.json({ ...row, cronjob_ids: ids })
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
