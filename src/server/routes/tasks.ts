import { Router } from 'express'
import db from '../db.js'

const router = Router()

router.get('/', (req, res) => {
  const { project_id, column_id } = req.query
  let sql = 'SELECT * FROM tasks'
  const conditions: string[] = []
  const params: unknown[] = []

  if (project_id) {
    conditions.push('project_id = ?')
    params.push(project_id)
  }
  if (column_id) {
    conditions.push('column_id = ?')
    params.push(column_id)
  }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY position ASC, id ASC'

  const rows = db.prepare(sql).all(...params)
  res.json(rows)
})

router.post('/', (req, res) => {
  const { title, description, column_id, github_url, project_id } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })

  // Get next position in column
  const col = column_id || 'backlog'
  const last = db.prepare(
    'SELECT MAX(position) as maxPos FROM tasks WHERE column_id = ?'
  ).get(col) as { maxPos: number | null }
  const position = (last?.maxPos ?? 0) + 1

  const result = db.prepare(
    'INSERT INTO tasks (title, description, column_id, position, github_url, project_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(title, description || '', col, position, github_url || '', project_id || null)
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid)
  res.status(201).json(row)
})

router.put('/:id', (req, res) => {
  const { title, description, github_url, project_id } = req.body
  db.prepare(
    `UPDATE tasks SET title = COALESCE(?, title), description = COALESCE(?, description),
     github_url = COALESCE(?, github_url), project_id = COALESCE(?, project_id),
     updated_at = datetime('now') WHERE id = ?`
  ).run(title, description, github_url, project_id, req.params.id)
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.put('/:id/move', (req, res) => {
  const { column_id, position } = req.body
  if (!column_id || position === undefined) {
    return res.status(400).json({ error: 'column_id and position are required' })
  }
  db.prepare(
    `UPDATE tasks SET column_id = ?, position = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(column_id, position, req.params.id)
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router
