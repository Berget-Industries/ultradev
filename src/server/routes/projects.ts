import { Router } from 'express'
import db from '../db.js'

const router = Router()

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all()
  res.json(rows)
})

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.post('/', (req, res) => {
  const { name, repo_url, description, status } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })
  const result = db.prepare(
    'INSERT INTO projects (name, repo_url, description, status) VALUES (?, ?, ?, ?)'
  ).run(name, repo_url || '', description || '', status || 'active')
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid)
  res.status(201).json(row)
})

router.put('/:id', (req, res) => {
  const { name, repo_url, description, status } = req.body
  db.prepare(
    `UPDATE projects SET name = COALESCE(?, name), repo_url = COALESCE(?, repo_url),
     description = COALESCE(?, description), status = COALESCE(?, status),
     updated_at = datetime('now') WHERE id = ?`
  ).run(name, repo_url, description, status, req.params.id)
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
