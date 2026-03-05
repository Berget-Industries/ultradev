import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ExternalLink, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Task } from './TaskForm'

interface Props {
  task: Task
  onEdit: (t: Task) => void
  onDelete: (id: number) => void
}

export function KanbanCard({ task, onEdit, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <Card ref={setNodeRef} style={style} className="p-3 space-y-2 cursor-default">
      <div className="flex items-start gap-1">
        <button {...attributes} {...listeners} className="mt-0.5 cursor-grab text-muted-foreground hover:text-foreground">
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="flex-1 text-sm font-medium">{task.title}</span>
        <div className="flex shrink-0">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit(task)}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDelete(task.id)}>
            <Trash2 className="h-3 w-3 text-destructive-foreground" />
          </Button>
        </div>
      </div>
      {task.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 pl-5">{task.description}</p>
      )}
      {task.github_url && (
        <a
          href={task.github_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-400 hover:underline pl-5"
        >
          <ExternalLink className="h-3 w-3" />
          GitHub
        </a>
      )}
    </Card>
  )
}
