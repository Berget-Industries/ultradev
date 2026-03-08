import { Router } from 'express'
import db from '../db.js'

const router = Router()

router.get('/', async (_req, res) => {
  const { rows } = await db.query('SELECT * FROM cronjobs ORDER BY created_at DESC')
  res.json(rows)
})

router.post('/', async (req, res) => {
  const { name, schedule, description, command, status } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const { rows: [row] } = await db.query(
    'INSERT INTO cronjobs (name, schedule, description, command, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [name, schedule || '* * * * *', description || '', command || '', status || 'active']
  )
  res.status(201).json(row)
})

router.put('/:id', async (req, res) => {
  const { name, schedule, description, command, status, last_run, next_run } = req.body
  const { rows: [row] } = await db.query(
    `UPDATE cronjobs SET name = COALESCE($1, name), schedule = COALESCE($2, schedule),
     description = COALESCE($3, description), command = COALESCE($4, command),
     status = COALESCE($5, status), last_run = COALESCE($6, last_run),
     next_run = COALESCE($7, next_run), updated_at = NOW() WHERE id = $8 RETURNING *`,
    [name, schedule, description, command, status, last_run, next_run, req.params.id]
  )
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM cronjobs WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

export default router
