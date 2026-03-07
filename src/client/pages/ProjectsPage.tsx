import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectList } from '@/components/projects/ProjectList'
import { ProjectForm, type Project, type CronjobOption } from '@/components/projects/ProjectForm'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'

export default function ProjectsPage() {
  const { data: projects, refresh: refreshProjects } = useStore<Project[]>('/projects', () => api.get('/projects'))
  const { data: cronjobs } = useStore<CronjobOption[]>('/cronjobs', () => api.get('/cronjobs'))
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)

  const handleSubmit = async (data: Partial<Project>) => {
    if (editing) {
      await api.put(`/projects/${editing.id}`, data)
    } else {
      await api.post('/projects', data)
    }
    setEditing(null)
    refreshProjects()
  }

  const handleEdit = (p: Project) => {
    setEditing(p)
    setDialogOpen(true)
  }

  const handleDelete = async (id: number) => {
    await api.del(`/projects/${id}`)
    refreshProjects()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Repos</h1>
        <Button onClick={() => { setEditing(null); setDialogOpen(true) }}>
          <Plus className="h-4 w-4" /> New Repo
        </Button>
      </div>
      <ProjectList projects={projects ?? []} onEdit={handleEdit} onDelete={handleDelete} />
      <ProjectForm
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        project={editing}
        cronjobs={cronjobs ?? []}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
