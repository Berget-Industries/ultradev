import { Router } from 'express'
import db from '../db.js'

const router = Router()

router.get('/', async (_req, res) => {
  const { rows } = await db.query(`
    SELECT p.*, STRING_AGG(pc.cronjob_id::text, ',') as cronjob_ids
    FROM projects p
    LEFT JOIN project_cronjobs pc ON pc.project_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `)
  const result = rows.map(r => ({
    ...r,
    cronjob_ids: r.cronjob_ids ? r.cronjob_ids.split(',').map(Number) : [],
  }))
  res.json(result)
})

router.get('/:id', async (req, res) => {
  const { rows: [row] } = await db.query('SELECT * FROM projects WHERE id = $1', [req.params.id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  const { rows: cronjobRows } = await db.query(
    'SELECT cronjob_id FROM project_cronjobs WHERE project_id = $1', [req.params.id]
  )
  res.json({ ...row, cronjob_ids: cronjobRows.map(r => r.cronjob_id) })
})

router.post('/', async (req, res) => {
  const { name, repo_url, description, status, cronjob_ids } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const { rows: [inserted] } = await db.query(
    'INSERT INTO projects (name, repo_url, description, status) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, repo_url || '', description || '', status || 'active']
  )
  if (Array.isArray(cronjob_ids)) {
    for (const cid of cronjob_ids) {
      await db.query('INSERT INTO project_cronjobs (project_id, cronjob_id) VALUES ($1, $2)', [inserted.id, cid])
    }
  }
  res.status(201).json({ ...inserted, cronjob_ids: cronjob_ids || [] })
})

router.put('/:id', async (req, res) => {
  const { name, repo_url, description, status, cronjob_ids } = req.body
  await db.query(
    `UPDATE projects SET name = COALESCE($1, name), repo_url = COALESCE($2, repo_url),
     description = COALESCE($3, description), status = COALESCE($4, status),
     updated_at = NOW() WHERE id = $5`,
    [name, repo_url, description, status, req.params.id]
  )
  if (Array.isArray(cronjob_ids)) {
    await db.query('DELETE FROM project_cronjobs WHERE project_id = $1', [req.params.id])
    for (const cid of cronjob_ids) {
      await db.query('INSERT INTO project_cronjobs (project_id, cronjob_id) VALUES ($1, $2)', [req.params.id, cid])
    }
  }
  const { rows: [row] } = await db.query('SELECT * FROM projects WHERE id = $1', [req.params.id])
  if (!row) return res.status(404).json({ error: 'Not found' })
  const { rows: cronjobRows } = await db.query(
    'SELECT cronjob_id FROM project_cronjobs WHERE project_id = $1', [req.params.id]
  )
  res.json({ ...row, cronjob_ids: cronjobRows.map(r => r.cronjob_id) })
})

router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM projects WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

export default router
