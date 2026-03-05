import { useState, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { KanbanColumn } from './KanbanColumn'
import { KanbanCard } from './KanbanCard'
import type { Task } from './TaskForm'
import { api } from '@/lib/api'

const COLUMNS = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'working', label: 'Working' },
  { id: 'pr', label: 'PR' },
  { id: 'merged', label: 'Merged' },
]

interface Props {
  tasks: Task[]
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  onAddTask: (columnId: string) => void
  onEditTask: (t: Task) => void
  onDeleteTask: (id: number) => void
}

export function KanbanBoard({ tasks, setTasks, onAddTask, onEditTask, onDeleteTask }: Props) {
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const getColumnTasks = useCallback(
    (colId: string) => tasks.filter(t => t.column_id === colId).sort((a, b) => a.position - b.position),
    [tasks]
  )

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id)
    if (task) setActiveTask(task)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return

    const activeId = active.id as number
    const overId = over.id

    const activeTaskData = tasks.find(t => t.id === activeId)
    if (!activeTaskData) return

    // Determine target column
    let targetColumn: string
    const overTask = tasks.find(t => t.id === overId)
    if (overTask) {
      targetColumn = overTask.column_id
    } else if (typeof overId === 'string' && COLUMNS.some(c => c.id === overId)) {
      targetColumn = overId
    } else {
      return
    }

    if (activeTaskData.column_id !== targetColumn) {
      setTasks(prev =>
        prev.map(t =>
          t.id === activeId ? { ...t, column_id: targetColumn } : t
        )
      )
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null)
    const { active, over } = event
    if (!over) return

    const activeId = active.id as number
    const overId = over.id

    const activeTask = tasks.find(t => t.id === activeId)
    if (!activeTask) return

    // Determine target column
    let targetColumn = activeTask.column_id
    const overTask = tasks.find(t => t.id === overId)
    if (overTask) {
      targetColumn = overTask.column_id
    } else if (typeof overId === 'string' && COLUMNS.some(c => c.id === overId)) {
      targetColumn = overId as string
    }

    // Reorder within column
    const columnTasks = tasks
      .filter(t => t.column_id === targetColumn)
      .sort((a, b) => a.position - b.position)

    const oldIndex = columnTasks.findIndex(t => t.id === activeId)
    const newIndex = overTask ? columnTasks.findIndex(t => t.id === overId) : columnTasks.length - 1

    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      const reordered = arrayMove(columnTasks, oldIndex, newIndex)
      // Assign fractional positions
      const updated = reordered.map((t, i) => ({ ...t, position: i + 1 }))
      setTasks(prev => {
        const other = prev.filter(t => t.column_id !== targetColumn)
        return [...other, ...updated]
      })
    }

    // Compute new position
    const finalColumnTasks = tasks
      .filter(t => t.column_id === targetColumn && t.id !== activeId)
      .sort((a, b) => a.position - b.position)

    let newPosition: number
    if (overTask && overTask.id !== activeId) {
      const idx = finalColumnTasks.findIndex(t => t.id === overTask.id)
      if (idx === 0) {
        newPosition = finalColumnTasks[0].position / 2
      } else if (idx >= 0) {
        newPosition = (finalColumnTasks[idx - 1].position + finalColumnTasks[idx].position) / 2
      } else {
        newPosition = (finalColumnTasks[finalColumnTasks.length - 1]?.position ?? 0) + 1
      }
    } else {
      newPosition = (finalColumnTasks[finalColumnTasks.length - 1]?.position ?? 0) + 1
    }

    await api.put(`/tasks/${activeId}/move`, { column_id: targetColumn, position: newPosition }).catch(() => {})
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map(col => (
          <KanbanColumn
            key={col.id}
            id={col.id}
            label={col.label}
            tasks={getColumnTasks(col.id)}
            onAddTask={onAddTask}
            onEditTask={onEditTask}
            onDeleteTask={onDeleteTask}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <KanbanCard task={activeTask} onEdit={() => {}} onDelete={() => {}} />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
