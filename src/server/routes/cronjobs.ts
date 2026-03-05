import { Router } from 'express'
import db from '../db.js'

const router = Router()

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM cronjobs ORDER BY created_at DESC').all()
  res.json(rows)
})

router.post('/', (req, res) => {
  const { name, schedule, description, command, status } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const result = db.prepare(
    'INSERT INTO cronjobs (name, schedule, description, command, status) VALUES (?, ?, ?, ?, ?)'
  ).run(name, schedule || '* * * * *', description || '', command || '', status || 'active')
  const row = db.prepare('SELECT * FROM cronjobs WHERE id = ?').get(result.lastInsertRowid)
  res.status(201).json(row)
})

router.put('/:id', (req, res) => {
  const { name, schedule, description, command, status, last_run, next_run } = req.body
  db.prepare(
    `UPDATE cronjobs SET name = COALESCE(?, name), schedule = COALESCE(?, schedule),
     description = COALESCE(?, description), command = COALESCE(?, command),
     status = COALESCE(?, status), last_run = COALESCE(?, last_run),
     next_run = COALESCE(?, next_run), updated_at = datetime('now') WHERE id = ?`
  ).run(name, schedule, description, command, status, last_run, next_run, req.params.id)
  const row = db.prepare('SELECT * FROM cronjobs WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM cronjobs WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
