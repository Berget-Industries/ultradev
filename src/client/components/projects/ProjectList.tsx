import { ExternalLink, Pencil, Trash2, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import type { Project } from './ProjectForm'

const statusColor: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  paused: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  archived: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
}

interface Props {
  projects: Project[]
  onEdit: (p: Project) => void
  onDelete: (id: number) => void
}

export function ProjectList({ projects, onEdit, onDelete }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Repo</TableHead>
          <TableHead>Crons</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="w-24">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
              No projects yet. Create one to get started.
            </TableCell>
          </TableRow>
        )}
        {projects.map(p => (
          <TableRow key={p.id}>
            <TableCell className="font-medium">{p.name}</TableCell>
            <TableCell>
              {p.repo_url ? (
                <a href={p.repo_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-400 hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  {p.repo_url.replace(/^https?:\/\/(github\.com\/)?/, '')}
                </a>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </TableCell>
            <TableCell>
              {p.cronjob_ids?.length > 0 ? (
                <Badge variant="outline" className="text-xs gap-1">
                  <Clock className="h-3 w-3" />
                  {p.cronjob_ids.length}
                </Badge>
              ) : (
                <span className="text-muted-foreground text-xs">none</span>
              )}
            </TableCell>
            <TableCell>
              <Badge className={statusColor[p.status]}>{p.status}</Badge>
            </TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{p.description || '-'}</TableCell>
            <TableCell>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => onEdit(p)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => onDelete(p.id)}><Trash2 className="h-4 w-4 text-destructive-foreground" /></Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
