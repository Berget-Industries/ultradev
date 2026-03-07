import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectList } from '@/components/projects/ProjectList'
import { ProjectForm, type Project, type CronjobOption } from '@/components/projects/ProjectForm'
import { api } from '@/lib/api'

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [cronjobs, setCronjobs] = useState<CronjobOption[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)

  const load = () => {
    api.get<Project[]>('/projects').then(setProjects)
    api.get<CronjobOption[]>('/cronjobs').then(setCronjobs)
  }

  useEffect(() => { load() }, [])

  const handleSubmit = async (data: Partial<Project>) => {
    if (editing) {
      await api.put(`/projects/${editing.id}`, data)
    } else {
      await api.post('/projects', data)
    }
    setEditing(null)
    load()
  }

  const handleEdit = (p: Project) => {
    setEditing(p)
    setDialogOpen(true)
  }

  const handleDelete = async (id: number) => {
    await api.del(`/projects/${id}`)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Repos</h1>
        <Button onClick={() => { setEditing(null); setDialogOpen(true) }}>
          <Plus className="h-4 w-4" /> New Repo
        </Button>
      </div>
      <ProjectList projects={projects} onEdit={handleEdit} onDelete={handleDelete} />
      <ProjectForm
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        project={editing}
        cronjobs={cronjobs}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
