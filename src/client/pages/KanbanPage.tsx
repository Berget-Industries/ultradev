import { useEffect, useState, useCallback } from 'react'
import { ExternalLink, Terminal, Plus, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LogViewer } from '@/components/LogViewer'
import { TaskForm, type Task } from '@/components/kanban/TaskForm'
import { api } from '@/lib/api'

// --- Types ---

interface WorkItem {
  key: string
  repo: string
  number?: number
  type: string
  status: string
  attempts: number
  prUrl: string | null
  error: string | null
  logFile: string | null
  updatedAt: number | null
}

interface OrchestratorState {
  workQueue: WorkItem[]
  [k: string]: unknown
}

// --- Column definitions ---

interface ColumnDef {
  id: string
  label: string
  workStatuses: string[]
  taskColumnIds: string[]
}

const COLUMNS: ColumnDef[] = [
  { id: 'backlog',  label: 'Backlog',  workStatuses: ['failed'],                    taskColumnIds: ['backlog'] },
  { id: 'assigned', label: 'Assigned', workStatuses: ['idle'],                      taskColumnIds: ['assigned'] },
  { id: 'working',  label: 'Working',  workStatuses: ['in_progress'],               taskColumnIds: ['working'] },
  { id: 'pr',       label: 'PR',       workStatuses: ['awaiting_ci', 'ci_failed'],  taskColumnIds: ['pr'] },
  { id: 'done',     label: 'Done',     workStatuses: ['done'],                      taskColumnIds: ['done', 'merged'] },
]

// --- Helpers ---

function statusColor(status: string): string {
  switch (status) {
    case 'done':        return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'in_progress': return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'awaiting_ci': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'ci_failed':   return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    case 'failed':      return 'bg-red-500/20 text-red-400 border-red-500/30'
    case 'idle':        return 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30'
    default:            return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
  }
}

function shortKey(key: string): string {
  // "Flawless-Agency/klipped#490" → "klipped#490"
  const slash = key.lastIndexOf('/')
  return slash >= 0 ? key.slice(slash + 1) : key
}

function typeBadgeColor(type: string): string {
  return type === 'pr'
    ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
    : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
}

// --- Work queue card ---

function WorkCard({ item, onClick }: { item: WorkItem; onClick: () => void }) {
  return (
    <div
      className="bg-zinc-800/50 rounded-md p-3 border border-zinc-700/50 hover:border-zinc-600 transition-colors cursor-pointer space-y-2"
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-medium text-zinc-200 truncate">
          {shortKey(item.key)}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {item.prUrl && (
            <a
              href={item.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 transition-colors"
              onClick={e => e.stopPropagation()}
              title="Open PR"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {item.logFile && (
            <Terminal className="h-3.5 w-3.5 text-zinc-500" />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge className={statusColor(item.status)} variant="outline">
          {item.status.replace('_', ' ')}
        </Badge>
        <Badge className={typeBadgeColor(item.type)} variant="outline">
          {item.type}
        </Badge>
        {item.attempts > 1 && (
          <span className="text-[10px] font-mono text-zinc-500">
            x{item.attempts}
          </span>
        )}
      </div>
      {item.error && (
        <p className="text-[11px] text-red-400/80 line-clamp-1 font-mono">
          {item.error}
        </p>
      )}
    </div>
  )
}

// --- Manual task card (simplified, no DnD) ---

function ManualTaskCard({
  task,
  onEdit,
  onDelete,
}: {
  task: Task
  onEdit: (t: Task) => void
  onDelete: (id: number) => void
}) {
  return (
    <div className="bg-zinc-800/50 rounded-md p-3 border border-zinc-700/50 hover:border-zinc-600 transition-colors space-y-1.5">
      <div className="flex items-start justify-between gap-1">
        <span className="text-sm font-medium text-zinc-200 flex-1">{task.title}</span>
        <div className="flex shrink-0">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit(task)}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDelete(task.id)}>
            <Trash2 className="h-3 w-3 text-red-400" />
          </Button>
        </div>
      </div>
      {task.description && (
        <p className="text-xs text-zinc-500 line-clamp-2">{task.description}</p>
      )}
      {task.github_url && (
        <a
          href={task.github_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-400 hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          GitHub
        </a>
      )}
    </div>
  )
}

// --- Column ---

function Column({
  col,
  workItems,
  tasks,
  onWorkItemClick,
  onAddTask,
  onEditTask,
  onDeleteTask,
}: {
  col: ColumnDef
  workItems: WorkItem[]
  tasks: Task[]
  onWorkItemClick: (item: WorkItem) => void
  onAddTask: (columnId: string) => void
  onEditTask: (t: Task) => void
  onDeleteTask: (id: number) => void
}) {
  const totalCount = workItems.length + tasks.length

  return (
    <div className="flex flex-col min-w-[240px] bg-zinc-900/50 rounded-lg border border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800/60">
        <h3 className="font-medium text-sm text-zinc-400">{col.label}</h3>
        <Badge variant="secondary" className="text-[10px] h-5 min-w-[20px] justify-center">
          {totalCount}
        </Badge>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 p-2 min-h-[120px] flex-1">
        {workItems.map(item => (
          <WorkCard
            key={item.key}
            item={item}
            onClick={() => onWorkItemClick(item)}
          />
        ))}
        {tasks.map(task => (
          <ManualTaskCard
            key={`task-${task.id}`}
            task={task}
            onEdit={onEditTask}
            onDelete={onDeleteTask}
          />
        ))}
        {totalCount === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-zinc-600">
            No items
          </div>
        )}
      </div>

      {/* Add task button */}
      <div className="px-2 pb-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-zinc-500 hover:text-zinc-300"
          onClick={() => onAddTask(col.id)}
        >
          <Plus className="h-4 w-4 mr-1" /> Add task
        </Button>
      </div>
    </div>
  )
}

// --- Page ---

export default function KanbanPage() {
  const [workQueue, setWorkQueue] = useState<WorkItem[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [viewingLog, setViewingLog] = useState<WorkItem | null>(null)

  // Task form state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [addColumn, setAddColumn] = useState<string>('backlog')

  const load = useCallback(() => {
    api.get<OrchestratorState>('/orchestrator')
      .then(s => setWorkQueue(s.workQueue ?? []))
      .catch(() => {})
    api.get<Task[]>('/tasks')
      .then(setTasks)
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 10_000)
    return () => clearInterval(id)
  }, [load])

  // Build lookup: column id → work items
  const workByColumn = useCallback(
    (colId: string): WorkItem[] => {
      const col = COLUMNS.find(c => c.id === colId)
      if (!col) return []
      return workQueue.filter(w => col.workStatuses.includes(w.status))
    },
    [workQueue],
  )

  // Build lookup: column id → manual tasks
  const tasksByColumn = useCallback(
    (colId: string): Task[] => {
      const col = COLUMNS.find(c => c.id === colId)
      if (!col) return []
      return tasks
        .filter(t => col.taskColumnIds.includes(t.column_id))
        .sort((a, b) => a.position - b.position)
    },
    [tasks],
  )

  // Handlers
  const handleWorkItemClick = (item: WorkItem) => {
    if (item.logFile) {
      setViewingLog(item)
    }
  }

  const handleAddTask = (columnId: string) => {
    setEditing(null)
    setAddColumn(columnId)
    setDialogOpen(true)
  }

  const handleEditTask = (t: Task) => {
    setEditing(t)
    setDialogOpen(true)
  }

  const handleDeleteTask = async (id: number) => {
    await api.del(`/tasks/${id}`)
    load()
  }

  const handleSubmit = async (data: Partial<Task>) => {
    if (editing) {
      await api.put(`/tasks/${editing.id}`, data)
    } else {
      await api.post('/tasks', data)
    }
    setEditing(null)
    load()
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Kanban Board</h1>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map(col => (
          <Column
            key={col.id}
            col={col}
            workItems={workByColumn(col.id)}
            tasks={tasksByColumn(col.id)}
            onWorkItemClick={handleWorkItemClick}
            onAddTask={handleAddTask}
            onEditTask={handleEditTask}
            onDeleteTask={handleDeleteTask}
          />
        ))}
      </div>

      {/* Manual task form dialog */}
      <TaskForm
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editing}
        columnId={addColumn}
        onSubmit={handleSubmit}
      />

      {/* Log viewer slide-over */}
      {viewingLog && (
        <LogViewer
          issueKey={viewingLog.key}
          status={viewingLog.status}
          onClose={() => setViewingLog(null)}
        />
      )}
    </div>
  )
}
