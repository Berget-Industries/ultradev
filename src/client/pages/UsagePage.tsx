import { useEffect, useState } from 'react'
import {
  DollarSign,
  Hash,
  Zap,
  Clock,
  TrendingUp,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api'

// --- Types ---

interface TaskUsage {
  logFile: string
  issueKey: string
  repo: string
  number: number | null
  status: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  costUsd: number | null
  durationMs: number | null
  numTurns: number | null
  toolCalls: number
  date: string
  timestamp: number
}

interface DailyUsage {
  date: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  taskCount: number
}

interface UsageData {
  today: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    costUsd: number
    taskCount: number
  }
  allTime: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    costUsd: number
    taskCount: number
  }
  daily: DailyUsage[]
  tasks: TaskUsage[]
}

// --- Formatters ---

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatTokensFull(n: number): string {
  return n.toLocaleString()
}

function formatCost(cost: number | null): string {
  if (cost === null || cost === undefined) return '--'
  return `$${cost.toFixed(2)}`
}

function formatCostPrecise(cost: number | null): string {
  if (cost === null || cost === undefined) return '--'
  return `$${cost.toFixed(4)}`
}

function formatDuration(ms: number | null): string {
  if (!ms) return '--'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function statusBadgeColor(status: string): string {
  switch (status) {
    case 'done': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'in_progress': return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'failed': return 'bg-red-500/20 text-red-400 border-red-500/30'
    default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
  }
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// --- Bar Chart ---

function DailyBarChart({ daily }: { daily: DailyUsage[] }) {
  const maxCost = Math.max(...daily.map(d => d.costUsd), 0.01)
  const maxTokens = Math.max(...daily.map(d => d.totalTokens), 1)
  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-3">
      {/* Cost bars */}
      <div>
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <DollarSign className="h-3 w-3" />
          Daily Cost (14 days)
        </div>
        <div className="flex items-end gap-1 h-24">
          {daily.map((d) => {
            const heightPercent = maxCost > 0 ? (d.costUsd / maxCost) * 100 : 0
            const isToday = d.date === todayStr
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                <div className="w-full flex flex-col items-center justify-end h-20">
                  <div
                    className={`w-full rounded-t transition-all duration-300 ${
                      isToday ? 'bg-blue-500' : d.costUsd > 0 ? 'bg-zinc-600 group-hover:bg-zinc-500' : 'bg-zinc-800'
                    }`}
                    style={{ height: `${Math.max(heightPercent, d.costUsd > 0 ? 4 : 1)}%`, minHeight: d.costUsd > 0 ? '2px' : '1px' }}
                  />
                </div>
                <span className={`text-[8px] font-mono ${isToday ? 'text-blue-400' : 'text-zinc-600'}`}>
                  {d.date.slice(5)}
                </span>
                {/* Tooltip */}
                <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
                  <div className="text-zinc-300">{shortDate(d.date)}</div>
                  <div className="text-green-400">{formatCost(d.costUsd)}</div>
                  <div className="text-zinc-400">{formatTokens(d.totalTokens)} tokens</div>
                  <div className="text-zinc-500">{d.taskCount} tasks</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Token bars */}
      <div>
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Hash className="h-3 w-3" />
          Daily Tokens (14 days)
        </div>
        <div className="flex items-end gap-1 h-24">
          {daily.map((d) => {
            const inputPct = maxTokens > 0 ? (d.inputTokens / maxTokens) * 100 : 0
            const outputPct = maxTokens > 0 ? (d.outputTokens / maxTokens) * 100 : 0
            const isToday = d.date === todayStr
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                <div className="w-full flex flex-col items-center justify-end h-20">
                  <div className="w-full flex flex-col justify-end" style={{ height: '100%' }}>
                    <div
                      className={`w-full ${isToday ? 'bg-purple-500' : 'bg-purple-500/40'} transition-all duration-300`}
                      style={{ height: `${Math.max(outputPct, d.outputTokens > 0 ? 2 : 0)}%`, minHeight: d.outputTokens > 0 ? '1px' : '0' }}
                    />
                    <div
                      className={`w-full rounded-t ${isToday ? 'bg-cyan-500' : 'bg-cyan-500/40'} transition-all duration-300`}
                      style={{ height: `${Math.max(inputPct, d.inputTokens > 0 ? 2 : 0)}%`, minHeight: d.inputTokens > 0 ? '1px' : '0' }}
                    />
                  </div>
                </div>
                <span className={`text-[8px] font-mono ${isToday ? 'text-blue-400' : 'text-zinc-600'}`}>
                  {d.date.slice(5)}
                </span>
                {/* Tooltip */}
                <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
                  <div className="text-zinc-300">{shortDate(d.date)}</div>
                  <div className="text-cyan-400">In: {formatTokens(d.inputTokens)}</div>
                  <div className="text-purple-400">Out: {formatTokens(d.outputTokens)}</div>
                  <div className="text-zinc-500">{d.taskCount} tasks</div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-4 mt-1">
          <div className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-cyan-500/60" />
            <span className="text-[9px] text-zinc-600">Input</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-purple-500/60" />
            <span className="text-[9px] text-zinc-600">Output</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Stat Card ---

function StatCard({
  icon: Icon,
  label,
  value,
  subtitle,
  color,
}: {
  icon: typeof DollarSign
  label: string
  value: string
  subtitle?: string
  color: string
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">{label}</span>
      </div>
      <div className="text-2xl font-mono font-bold text-zinc-100 tabular-nums">{value}</div>
      {subtitle && <div className="text-[11px] text-zinc-500 font-mono mt-1">{subtitle}</div>}
    </Card>
  )
}

// --- Main Component ---

export default function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = () => {
      api.get<UsageData>('/usage')
        .then(setData)
        .catch(err => setError(err.message))
    }
    load()
    const id = setInterval(load, 30_000) // refresh every 30s
    return () => clearInterval(id)
  }, [])

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400 text-sm">
        Failed to load usage data: {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
          Loading usage data...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* --- Summary Cards --- */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <TrendingUp className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-300">Today</span>
          <span className="text-[10px] text-zinc-600 font-mono ml-1">
            {new Date().toISOString().slice(0, 10)}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            icon={DollarSign}
            label="Cost"
            value={formatCost(data.today.costUsd)}
            color="text-green-400"
          />
          <StatCard
            icon={Hash}
            label="Tokens"
            value={formatTokens(data.today.totalTokens)}
            subtitle={`${formatTokens(data.today.inputTokens)} in / ${formatTokens(data.today.outputTokens)} out`}
            color="text-cyan-400"
          />
          <StatCard
            icon={Zap}
            label="Tasks"
            value={String(data.today.taskCount)}
            color="text-yellow-400"
          />
          <StatCard
            icon={ArrowUpRight}
            label="Avg Cost/Task"
            value={data.today.taskCount > 0 ? formatCost(data.today.costUsd / data.today.taskCount) : '--'}
            color="text-purple-400"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <BarChart3 className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-300">All Time</span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            icon={DollarSign}
            label="Total Cost"
            value={formatCost(data.allTime.costUsd)}
            color="text-green-400"
          />
          <StatCard
            icon={Hash}
            label="Total Tokens"
            value={formatTokens(data.allTime.totalTokens)}
            subtitle={`${formatTokens(data.allTime.inputTokens)} in / ${formatTokens(data.allTime.outputTokens)} out`}
            color="text-cyan-400"
          />
          <StatCard
            icon={Zap}
            label="Total Tasks"
            value={String(data.allTime.taskCount)}
            color="text-yellow-400"
          />
          <StatCard
            icon={ArrowDownRight}
            label="Avg Cost/Task"
            value={data.allTime.taskCount > 0 ? formatCost(data.allTime.costUsd / data.allTime.taskCount) : '--'}
            color="text-purple-400"
          />
        </div>
      </div>

      {/* --- Daily Chart --- */}
      <Card className="p-4">
        <DailyBarChart daily={data.daily} />
      </Card>

      {/* --- Per-Task Breakdown --- */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Clock className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-300">Per-Task Breakdown</span>
          <span className="text-xs font-mono text-zinc-600 ml-1">{data.tasks.length} logs</span>
        </div>
        <Card className="p-0 overflow-hidden">
          <div className="max-h-[500px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs sticky top-0 bg-zinc-950 z-10">Task</TableHead>
                  <TableHead className="text-xs sticky top-0 bg-zinc-950 z-10">Status</TableHead>
                  <TableHead className="text-xs sticky top-0 bg-zinc-950 z-10 text-right">Input</TableHead>
                  <TableHead className="text-xs sticky top-0 bg-zinc-950 z-10 text-right">Output</TableHead>
                  <TableHead className="text-xs sticky top-0 bg-zinc-950 z-10 text-right">Total</TableHead>
                  <TableHead className="text-xs sticky top-0 bg-zinc-950 z-10 text-right">Cost</TableHead>
                  <TableHead className="text-xs sticky top-0 bg-zinc-950 z-10 text-right">Duration</TableHead>
                  <TableHead className="text-xs sticky top-0 bg-zinc-950 z-10 text-right">Tools</TableHead>
                  <TableHead className="text-xs sticky top-0 bg-zinc-950 z-10">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.tasks.map((task) => (
                  <TableRow key={task.logFile}>
                    <TableCell className="font-mono text-xs text-zinc-200">
                      {task.issueKey}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusBadgeColor(task.status)}`}>
                        {task.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-cyan-400/80 text-right">
                      {formatTokensFull(task.inputTokens)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-purple-400/80 text-right">
                      {formatTokensFull(task.outputTokens)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-300 text-right">
                      {formatTokensFull(task.totalTokens)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-green-400 text-right">
                      {formatCostPrecise(task.costUsd)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-400 text-right">
                      {formatDuration(task.durationMs)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-400 text-right">
                      {task.toolCalls > 0 ? task.toolCalls : <span className="text-zinc-700">&mdash;</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-500">
                      {task.date}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  )
}
