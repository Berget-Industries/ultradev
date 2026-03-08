import { Router } from 'express'
import db from '../db.js'

const router = Router()

router.get('/', async (req, res) => {
  const { project_id, column_id } = req.query
  const conditions: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  if (project_id) {
    conditions.push(`project_id = $${paramIdx++}`)
    params.push(project_id)
  }
  if (column_id) {
    conditions.push(`column_id = $${paramIdx++}`)
    params.push(column_id)
  }

  let sql = 'SELECT * FROM tasks'
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY position ASC, id ASC'

  const { rows } = await db.query(sql, params)
  res.json(rows)
})

router.post('/', async (req, res) => {
  const { title, description, column_id, github_url, project_id } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })

  const col = column_id || 'backlog'
  const { rows: [last] } = await db.query(
    'SELECT MAX(position) as "maxPos" FROM tasks WHERE column_id = $1', [col]
  )
  const position = (last?.maxPos ?? 0) + 1

  const { rows: [row] } = await db.query(
    'INSERT INTO tasks (title, description, column_id, position, github_url, project_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [title, description || '', col, position, github_url || '', project_id || null]
  )
  res.status(201).json(row)
})

router.put('/:id', async (req, res) => {
  const { title, description, github_url, project_id } = req.body
  const { rows: [row] } = await db.query(
    `UPDATE tasks SET title = COALESCE($1, title), description = COALESCE($2, description),
     github_url = COALESCE($3, github_url), project_id = COALESCE($4, project_id),
     updated_at = NOW() WHERE id = $5 RETURNING *`,
    [title, description, github_url, project_id, req.params.id]
  )
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.put('/:id/move', async (req, res) => {
  const { column_id, position } = req.body
  if (!column_id || position === undefined) {
    return res.status(400).json({ error: 'column_id and position are required' })
  }
  const { rows: [row] } = await db.query(
    `UPDATE tasks SET column_id = $1, position = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
    [column_id, position, req.params.id]
  )
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM tasks WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

export default router
