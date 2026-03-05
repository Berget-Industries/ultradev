import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

export interface Project {
  id: number
  name: string
  repo_url: string
  description: string
  status: 'active' | 'paused' | 'archived'
  created_at: string
  updated_at: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: Project | null
  onSubmit: (data: Partial<Project>) => void
}

export function ProjectForm({ open, onOpenChange, project, onSubmit }: Props) {
  const [name, setName] = useState('')
  const [repo_url, setRepoUrl] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<string>('active')

  useEffect(() => {
    if (project) {
      setName(project.name)
      setRepoUrl(project.repo_url)
      setDescription(project.description)
      setStatus(project.status)
    } else {
      setName('')
      setRepoUrl('')
      setDescription('')
      setStatus('active')
    }
  }, [project, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({ name, repo_url, description, status: status as Project['status'] })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{project ? 'Edit Project' : 'New Project'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div>
            <label className="text-sm font-medium">Repo URL</label>
            <Input value={repo_url} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/..." />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>
          <div>
            <label className="text-sm font-medium">Status</label>
            <Select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{project ? 'Save' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
