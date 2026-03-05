import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KanbanCard } from './KanbanCard'
import type { Task } from './TaskForm'
import { cn } from '@/lib/utils'

interface Props {
  id: string
  label: string
  tasks: Task[]
  onAddTask: (columnId: string) => void
  onEditTask: (t: Task) => void
  onDeleteTask: (id: number) => void
}

export function KanbanColumn({ id, label, tasks, onAddTask, onEditTask, onDeleteTask }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: 'column' } })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-lg border bg-card/50 p-2",
        isOver && "border-primary/50 bg-primary/5"
      )}
    >
      <div className="flex items-center justify-between px-2 py-1 mb-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{label}</h3>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2 min-h-[100px]">
          {tasks.map(task => (
            <KanbanCard key={task.id} task={task} onEdit={onEditTask} onDelete={onDeleteTask} />
          ))}
        </div>
      </SortableContext>
      <Button variant="ghost" size="sm" className="mt-2 w-full justify-start text-muted-foreground" onClick={() => onAddTask(id)}>
        <Plus className="h-4 w-4 mr-1" /> Add task
      </Button>
    </div>
  )
}
