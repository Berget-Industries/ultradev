import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import type { Project } from '@/components/projects/ProjectForm'

export interface Task {
  id: number
  title: string
  description: string
  column_id: string
  position: number
  github_url: string
  project_id: number | null
  created_at: string
  updated_at: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  task?: Task | null
  columnId?: string
  onSubmit: (data: Partial<Task>) => void
}

export function TaskForm({ open, onOpenChange, task, columnId, onSubmit }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [github_url, setGithubUrl] = useState('')
  const [project_id, setProjectId] = useState<string>('')
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    api.get<Project[]>('/projects').then(setProjects).catch(() => {})
  }, [open])

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description)
      setGithubUrl(task.github_url)
      setProjectId(task.project_id ? String(task.project_id) : '')
    } else {
      setTitle('')
      setDescription('')
      setGithubUrl('')
      setProjectId('')
    }
  }, [task, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      title,
      description,
      github_url,
      project_id: project_id ? Number(project_id) : null,
      column_id: task?.column_id ?? columnId ?? 'backlog',
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Task' : 'New Task'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Title</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} required />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>
          <div>
            <label className="text-sm font-medium">GitHub URL</label>
            <Input value={github_url} onChange={e => setGithubUrl(e.target.value)} placeholder="https://github.com/..." />
          </div>
          <div>
            <label className="text-sm font-medium">Project</label>
            <Select value={project_id} onChange={e => setProjectId(e.target.value)}>
              <option value="">None</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{task ? 'Save' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
