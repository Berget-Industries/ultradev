import { useEffect, useState, useRef } from 'react'
import {
  Activity,
  Wrench,
  Zap,
  Clock,
  Radio,
  GitPullRequest,
  Search,
  Eye,
  Inbox,
  ExternalLink,
  Terminal,
  DollarSign,
  Cpu,
  Hash,
  Brain,
  AlertTriangle,
  Hourglass,
  MessageSquare,
  Square,
  Play,
  Ban,
  CheckCircle2,
  XCircle,
  Loader2,
  CircleDot,
  Shield,
  GitBranch,
  Check,
  X,
  Minus,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { LogViewer } from '@/components/LogViewer'
import { toolIcon } from '@/components/LogContent'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'

// --- Types ---

interface RecentTool {
  name: string
  label: string
  status: 'done' | 'running'
}

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

interface ThoughtEntry {
  text: string
  timestamp: number
}

interface CiCheck {
  name: string
  status: string
  conclusion: string | null
}

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
  toolCalls: number
  costUsd: number | null
  durationMs: number | null
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  peakContext: number
  contextHistory: number[]
  recentTools?: RecentTool[]
  lastThinking: string | null
  currentTool: string | null
  lastActivityMs: number | null
  detectedPrUrl: string | null
  todoList?: TodoItem[]
  thoughts?: ThoughtEntry[]
  agentCount?: number
  ciChecks?: CiCheck[]
}

interface PollerJob {
  name: string
  schedule: string
  lastRun: number | null
  status: string
  activeWorkers?: number
  activeReview?: string | null
  enabled: boolean
}

interface RateLimitState {
  rateLimited: boolean
  resetsAt: number | null
  resetsIn: number | null
}

interface OrchestratorState {
  uptime: number
  startedAt: number
  rateLimit: RateLimitState
  config: {
    githubUsername: string
    pollIntervalMs: number
    discordEnabled: boolean
    discordConnected: boolean
  }
  jobs: PollerJob[]
  discord: { status: string }
  workQueue: WorkItem[]
}

interface StatsData {
  cpu: { percent: number; cores: number }
  memory: { total: number; used: number; free: number; percent: number }
  load: { '1m': number; '5m': number; '15m': number }
  uptime: number
  platform: string
  hostname: string
}

interface OpenIssueLinkedPr {
  number: number
  url: string
  state: string
  ciStatus: 'passing' | 'failing' | 'pending' | 'none'
  mergeable: boolean
  reviewDecision: string | null
}

interface OpenIssue {
  repo: string
  number: number
  title: string
  labels: string[]
  linkedPr: OpenIssueLinkedPr | null
  status: 'no_pr' | 'ci_pending' | 'ci_failing' | 'changes_requested' | 'ready_to_merge' | 'merged'
}

// --- Formatters ---

function formatTokens(n: number): string {
  return n.toLocaleString()
}

function formatDuration(ms: number | null): string {
  if (!ms) return '--'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function formatCost(cost: number | null): string {
  if (cost === null || cost === undefined) return '--'
  return `$${cost.toFixed(4)}`
}

function formatBytes(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1)
}

function formatTime(ts: number | null): string {
  if (!ts) return '--'
  return new Date(ts).toLocaleTimeString()
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'never'
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// --- Color helpers ---

function ringColor(percent: number): string {
  if (percent > 80) return '#ef4444'
  if (percent > 50) return '#eab308'
  return '#22c55e'
}

function pollerStatusColor(status: string): string {
  switch (status) {
    case 'idle': return 'text-zinc-500'
    case 'polling': case 'reviewing': return 'text-blue-400'
    case 'error': return 'text-red-400'
    default: return 'text-zinc-500'
  }
}

function pollerDot(status: string): string {
  switch (status) {
    case 'idle': return 'bg-zinc-600'
    case 'polling': case 'reviewing': return 'bg-blue-400 animate-pulse'
    case 'error': return 'bg-red-400'
    default: return 'bg-zinc-600'
  }
}

function pollerIcon(name: string) {
  if (name.includes('Issue')) return Search
  if (name.includes('PR')) return GitPullRequest
  if (name.includes('Review')) return Eye
  return Radio
}

function statusBadgeColor(status: string): string {
  switch (status) {
    case 'done': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'in_progress': return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'failed': return 'bg-red-500/20 text-red-400 border-red-500/30'
    default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
  }
}

function typeBadgeColor(type: string): string {
  switch (type) {
    case 'issue': return 'bg-purple-500/10 text-purple-400 border-purple-500/20'
    case 'pr': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
    default: return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
  }
}

// --- Stat Ring (inline, smaller) ---

function StatRing({ percent, label, subtitle }: { percent: number; label: string; subtitle: string }) {
  const size = 40
  const stroke = 4
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - percent / 100)
  const color = ringColor(percent)

  return (
    <div className="flex items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272a" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-all duration-700 ease-out"
        />
        <text
          x={size / 2} y={size / 2}
          textAnchor="middle" dominantBaseline="central"
          fill="white" fontSize="10" fontFamily="monospace" fontWeight="bold"
        >
          {Math.round(percent)}%
        </text>
      </svg>
      <div>
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</div>
        <div className="text-[10px] text-zinc-600 font-mono">{subtitle}</div>
      </div>
    </div>
  )
}

// --- Animated number ---

function AnimatedNumber({ value, format }: { value: number; format?: (n: number) => string }) {
  const [display, setDisplay] = useState(value)
  const prevRef = useRef(value)

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = value
    if (prev === value) return

    const diff = value - prev
    const steps = 12
    const stepTime = 300 / steps
    let step = 0

    const timer = setInterval(() => {
      step++
      const progress = step / steps
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(prev + diff * eased))
      if (step >= steps) {
        clearInterval(timer)
        setDisplay(value)
      }
    }, stepTime)

    return () => clearInterval(timer)
  }, [value])

  const formatted = format ? format(display) : String(display)
  return <span className="transition-all duration-300">{formatted}</span>
}

// --- Live duration timer ---

function LiveDuration({ updatedAt, durationMs }: { updatedAt: number | null; durationMs: number | null }) {
  const [elapsed, setElapsed] = useState<number>(durationMs ?? 0)

  useEffect(() => {
    if (!updatedAt) {
      setElapsed(durationMs ?? 0)
      return
    }

    // durationMs tells us how long it's been running (from log file stats).
    // We augment it with a local timer for smooth counting.
    const baseMs = durationMs ?? 0

    const update = () => {
      // If durationMs is available from server, use it as base and add delta since last SSE update
      setElapsed(baseMs)
    }
    update()

    const id = setInterval(() => {
      setElapsed(prev => prev + 1000)
    }, 1000)

    return () => clearInterval(id)
  }, [updatedAt, durationMs])

  return <span className="font-mono tabular-nums">{formatDuration(elapsed)}</span>
}

// --- Main Component ---

export default function DashboardPage() {
  const [orchestrator, setOrchestrator] = useState<OrchestratorState | null>(null)
  const [viewingLog, setViewingLog] = useState<WorkItem | null>(null)
  const sseRef = useRef<EventSource | null>(null)

  const { data: stats } = useStore<StatsData>('/stats', () => api.get('/stats'), { pollInterval: 5_000 })
  const { data: openIssuesData } = useStore<OpenIssue[]>('/issues', () => api.get('/issues'), { pollInterval: 60_000 })
  const { data: activityLogData } = useStore<{ ts: number; source: string; message: string }[]>('/orchestrator/activity', () => api.get('/orchestrator/activity?limit=50'), { pollInterval: 10_000 })
  const openIssues = openIssuesData ?? []
  const activityLog = activityLogData ?? []

  // SSE connection for real-time orchestrator state
  useEffect(() => {
    const es = new EventSource('/api/orchestrator/live')
    sseRef.current = es

    es.onmessage = (e) => {
      try {
        const state = JSON.parse(e.data) as OrchestratorState
        setOrchestrator(state)
      } catch { /* skip bad frames */ }
    }

    es.onerror = () => {
      // EventSource will auto-reconnect
    }

    return () => {
      es.close()
      sseRef.current = null
    }
  }, [])

  if (!orchestrator) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
          Connecting...
        </div>
      </div>
    )
  }

  const byLatest = (a: WorkItem, b: WorkItem) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  const activeItems = orchestrator.workQueue.filter(w => w.status === 'in_progress').sort(byLatest)
  const queuedItems = orchestrator.workQueue.filter(w => w.status === 'failed' && w.attempts < 3).sort(byLatest)
  const staleItems = orchestrator.workQueue.filter(w => w.status === 'failed' && w.attempts >= 3).sort(byLatest)
  const doneItems = orchestrator.workQueue.filter(w => w.status !== 'in_progress' && w.status !== 'failed').sort(byLatest)
  const pollers = orchestrator.jobs

  return (
    <div className="space-y-4">
      {/* ---- System Health Strip ---- */}
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">System</span>
        </div>
        {stats ? (
          <>
            <StatRing
              percent={stats.cpu.percent}
              label="CPU"
              subtitle={`${stats.cpu.cores} cores`}
            />
            <StatRing
              percent={stats.memory.percent}
              label="RAM"
              subtitle={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)} GB`}
            />
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Load</div>
              <div className="text-sm font-mono font-bold transition-all duration-500">{stats.load['1m'].toFixed(2)}</div>
            </div>
          </>
        ) : (
          <span className="text-xs text-zinc-600">Loading...</span>
        )}

        {/* Divider */}
        <div className="h-6 w-px bg-zinc-800" />

        {/* ---- Pollers Strip (inline) ---- */}
        <div className="flex items-center gap-1.5">
          <Radio className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Pollers</span>
        </div>
        {pollers.map((job) => {
          const Icon = pollerIcon(job.name)
          const apiName = job.name.includes('Issue') ? 'issue-poller'
            : job.name.includes('PR') ? 'pr-poller'
            : 'work-reviewer'
          return (
            <div key={job.name} className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${pollerDot(job.status)}`} />
              <Icon className={`h-3 w-3 ${pollerStatusColor(job.status)}`} />
              <span className="text-[11px] text-zinc-400">{job.name}</span>
              <span className={`text-[10px] font-mono ${pollerStatusColor(job.status)}`}>
                {job.status}
              </span>
              <span className="text-[10px] font-mono text-zinc-600">{timeAgo(job.lastRun)}</span>
              <Switch
                checked={job.enabled}
                onCheckedChange={(checked) => {
                  fetch(`/api/orchestrator/jobs/${apiName}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: checked }),
                  })
                }}
                className="scale-75"
              />
            </div>
          )
        })}
      </div>

      {/* ---- Rate Limit Banner ---- */}
      {orchestrator.rateLimit?.rateLimited && (
        <Card className="p-3 border-yellow-500/30 bg-yellow-500/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-400" />
              <span className="text-sm font-medium text-yellow-400">Rate Limited</span>
              <span className="text-xs text-zinc-400">Operations paused automatically</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              {orchestrator.rateLimit.resetsAt && (
                <span className="text-yellow-400">
                  Resumes at {new Date(orchestrator.rateLimit.resetsAt * 1000).toLocaleTimeString()}
                </span>
              )}
              {orchestrator.rateLimit.resetsIn !== null && orchestrator.rateLimit.resetsIn > 0 && (
                <span className="text-zinc-500">
                  ({Math.ceil(orchestrator.rateLimit.resetsIn / 60000)}m left)
                </span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ---- Open Issues + Activity Log (2-col) ---- */}
      <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <GitBranch className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-300">Open Issues</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-zinc-500/10 text-zinc-400 border-zinc-500/20 ml-1">
            {openIssues.length}
          </Badge>
        </div>

        {openIssues.length === 0 ? (
          <Card className="p-4">
            <div className="flex items-center justify-center gap-2 text-zinc-600 text-sm">
              <Inbox className="h-4 w-4" />
              No open issues assigned.
            </div>
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <ScrollArea className="max-h-[200px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Issue</TableHead>
                    <TableHead className="text-xs">Labels</TableHead>
                    <TableHead className="text-xs">PR</TableHead>
                    <TableHead className="text-xs">CI</TableHead>
                    <TableHead className="text-xs">Review</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openIssues.map((issue) => (
                    <TableRow key={`${issue.repo}#${issue.number}`}>
                      <TableCell className="max-w-[300px]">
                        <a
                          href={`https://github.com/${issue.repo}/issues/${issue.number}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs hover:underline group"
                        >
                          <span className="font-mono text-zinc-500 shrink-0">
                            {issue.repo.split('/')[1]}#{issue.number}
                          </span>
                          <span className="text-zinc-300 truncate group-hover:text-blue-400">{issue.title}</span>
                          <ExternalLink className="h-3 w-3 text-zinc-600 shrink-0 opacity-0 group-hover:opacity-100" />
                        </a>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {issue.labels.length > 0 ? (
                            issue.labels.map((label) => (
                              <Badge key={label} variant="outline" className="text-[10px] px-1.5 py-0 bg-zinc-500/10 text-zinc-400 border-zinc-500/20">
                                {label}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-zinc-700">&mdash;</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {issue.linkedPr ? (
                          <a
                            href={issue.linkedPr.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                          >
                            #{issue.linkedPr.number}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-zinc-700">&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <OpenIssueCiCell ci={issue.linkedPr?.ciStatus ?? null} />
                      </TableCell>
                      <TableCell>
                        <OpenIssueReviewCell review={issue.linkedPr?.reviewDecision ?? null} />
                      </TableCell>
                      <TableCell>
                        <OpenIssueStatusBadge status={issue.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        )}
      </div>

      {/* ---- Activity Log ---- */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Radio className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-300">Activity Log</span>
          <span className="text-xs font-mono text-zinc-600 ml-1">{activityLog.length}</span>
        </div>
        <Card className="p-0 overflow-hidden">
          <ScrollArea className="max-h-[200px]">
            <div className="divide-y divide-zinc-800/50">
              {activityLog.length === 0 ? (
                <div className="flex items-center justify-center gap-2 text-zinc-600 text-sm p-4">
                  <Inbox className="h-4 w-4" />
                  No activity yet.
                </div>
              ) : (
                activityLog.map((entry, i) => (
                  <div key={`${entry.ts}-${i}`} className="px-3 py-1.5 flex items-start gap-2 text-xs">
                    <span className="font-mono text-zinc-600 shrink-0 tabular-nums">
                      {new Date(entry.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${
                      entry.source === 'notify' ? 'text-blue-400 border-blue-500/20' :
                      entry.source === 'poller' ? 'text-green-400 border-green-500/20' :
                      entry.source === 'pr-poller' ? 'text-purple-400 border-purple-500/20' :
                      'text-zinc-400 border-zinc-500/20'
                    }`}>
                      {entry.source}
                    </Badge>
                    <span className="text-zinc-300 break-words min-w-0">{entry.message}</span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </Card>
      </div>
      </div>

      {/* ---- Active Work ---- */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Zap className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium text-zinc-300">Active Work</span>
          {activeItems.length > 0 && (
            <span className="text-xs font-mono text-blue-400 ml-1">{activeItems.length}</span>
          )}
        </div>

        {activeItems.length === 0 ? (
          <Card className="p-4">
            <div className="flex items-center justify-center gap-2 text-zinc-600 text-sm">
              <Inbox className="h-4 w-4" />
              No active work. System is idle.
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {activeItems.map((item) => (
              <ActiveWorkCard key={item.key} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* ---- Queued (will retry) ---- */}
      {queuedItems.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Hourglass className="h-4 w-4 text-yellow-400" />
            <span className="text-sm font-medium text-zinc-300">Queued</span>
            <span className="text-xs font-mono text-yellow-400 ml-1">{queuedItems.length}</span>
          </div>
          <div className="space-y-1.5">
            {queuedItems.map((item) => (
              <Card
                key={item.key}
                className="px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-zinc-800/50"
                onClick={() => item.logFile && setViewingLog(item)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 shrink-0" />
                  <span className="font-mono text-sm text-zinc-200 truncate">{item.key}</span>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${typeBadgeColor(item.type)}`}>
                    {item.type}
                  </Badge>
                  <span className="text-[11px] text-zinc-500 font-mono">attempt {item.attempts}/3</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500 shrink-0">
                  {item.error && (
                    <span className="text-red-400 truncate max-w-[200px]">{item.error}</span>
                  )}
                  <span className="font-mono text-zinc-600">{timeAgo(item.updatedAt)}</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ---- Stale (gave up, can requeue) ---- */}
      {staleItems.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Ban className="h-4 w-4 text-red-400" />
            <span className="text-sm font-medium text-zinc-300">Stale</span>
            <span className="text-xs font-mono text-red-400 ml-1">{staleItems.length}</span>
            <span className="text-[10px] text-zinc-600 ml-1">— gave up after max attempts</span>
          </div>
          <div className="space-y-1.5">
            {staleItems.map((item) => (
              <Card
                key={item.key}
                className="px-4 py-2.5 flex items-center justify-between hover:bg-zinc-800/50"
              >
                <div className="flex items-center gap-2.5 min-w-0 cursor-pointer" onClick={() => item.logFile && setViewingLog(item)}>
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                  <span className="font-mono text-sm text-zinc-200 truncate">{item.key}</span>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${typeBadgeColor(item.type)}`}>
                    {item.type}
                  </Badge>
                  <span className="text-[11px] text-zinc-500 font-mono">{item.attempts} attempts</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {item.error && (
                    <span className="text-[11px] text-red-400 truncate max-w-[200px]">{item.error}</span>
                  )}
                  <span className="text-[10px] font-mono text-zinc-600">{timeAgo(item.updatedAt)}</span>
                  <button
                    onClick={() => {
                      fetch(`/api/orchestrator/requeue/${encodeURIComponent(item.key)}`, { method: 'POST' })
                    }}
                    className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20 px-2 py-0.5 rounded border border-green-500/20 transition-colors"
                    title="Requeue — reset attempts and retry"
                  >
                    <Play className="h-3 w-3" />
                    Requeue
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ---- History ---- */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Activity className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-300">History</span>
          <span className="text-xs font-mono text-zinc-600 ml-1">{doneItems.length}</span>
        </div>

        {doneItems.length === 0 ? (
          <Card className="p-4">
            <div className="flex items-center justify-center gap-2 text-zinc-600 text-sm">
              <Inbox className="h-4 w-4" />
              No history yet.
            </div>
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Key</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Attempts</TableHead>
                  <TableHead className="text-xs">Tools</TableHead>
                  <TableHead className="text-xs">Tokens</TableHead>
                  <TableHead className="text-xs">Cost</TableHead>
                  <TableHead className="text-xs">PR</TableHead>
                  <TableHead className="text-xs">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doneItems.map((item) => (
                  <TableRow
                    key={item.key}
                    className={item.logFile ? 'cursor-pointer hover:bg-zinc-800/50' : ''}
                    onClick={() => item.logFile && setViewingLog(item)}
                  >
                    <TableCell className="font-mono text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="text-zinc-200">{item.key}</span>
                        {item.logFile && <Terminal className="h-3 w-3 text-zinc-600" />}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${typeBadgeColor(item.type)}`}>
                        {item.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusBadgeColor(item.status)}`}>
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-400">{item.attempts}</TableCell>
                    <TableCell className="font-mono text-xs text-zinc-400">
                      {item.toolCalls > 0 ? item.toolCalls : <span className="text-zinc-700">&mdash;</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-400">
                      {item.totalTokens > 0 ? formatTokens(item.totalTokens) : <span className="text-zinc-700">&mdash;</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-400">
                      {item.costUsd ? formatCost(item.costUsd) : <span className="text-zinc-700">&mdash;</span>}
                    </TableCell>
                    <TableCell>
                      {(item.prUrl || item.detectedPrUrl) ? (
                        <a
                          href={item.prUrl || item.detectedPrUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          PR <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-zinc-700">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell className="text-zinc-500 text-xs font-mono">
                      {timeAgo(item.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

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

// --- Agent state helper ---

function agentState(item: WorkItem): { label: string; color: string; icon: typeof Zap } {
  // If no activity for 3+ minutes, might be stuck
  if (item.lastActivityMs && Date.now() - item.lastActivityMs > 180_000) {
    return { label: 'Possibly stuck', color: 'text-yellow-400', icon: AlertTriangle }
  }
  if (item.currentTool) {
    return { label: `Running: ${item.currentTool}`, color: 'text-blue-400', icon: Wrench }
  }
  if (item.lastThinking) {
    return { label: 'Thinking...', color: 'text-purple-400', icon: Brain }
  }
  if (item.toolCalls === 0) {
    return { label: 'Starting up...', color: 'text-zinc-400', icon: Hourglass }
  }
  return { label: 'Working...', color: 'text-blue-400', icon: Zap }
}

// --- Context Progress Ring (small inline) ---

function ContextRing({ current, max }: { current: number; max: number }) {
  const percent = max > 0 ? Math.min(100, (current / max) * 100) : 0
  const size = 36
  const stroke = 3
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - percent / 100)
  const color = ringColor(percent)

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272a" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-700 ease-out"
      />
      <text
        x={size / 2} y={size / 2}
        textAnchor="middle" dominantBaseline="central"
        fill="white" fontSize="8" fontFamily="monospace" fontWeight="bold"
      >
        {Math.round(percent)}%
      </text>
    </svg>
  )
}

// --- Todo dot color ---

function todoDotColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-green-400'
    case 'in_progress': return 'bg-blue-400 animate-pulse'
    default: return 'bg-yellow-400'
  }
}

function todoLabel(status: string): string {
  switch (status) {
    case 'completed': return 'Done'
    case 'in_progress': return 'Active'
    default: return 'Todo'
  }
}

// --- Tool status dot color ---

function toolDotColor(status: string): string {
  switch (status) {
    case 'done': return 'bg-green-400'
    case 'running': return 'bg-yellow-400 animate-pulse'
    default: return 'bg-zinc-500'
  }
}

// --- CI Check helpers ---

function ciCheckIcon(check: CiCheck) {
  if (check.conclusion === 'SUCCESS' || check.conclusion === 'success') {
    return <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
  }
  if (check.conclusion === 'FAILURE' || check.conclusion === 'failure' ||
      check.conclusion === 'TIMED_OUT' || check.conclusion === 'timed_out') {
    return <XCircle className="h-3 w-3 text-red-400 shrink-0" />
  }
  if (check.conclusion === 'SKIPPED' || check.conclusion === 'skipped' ||
      check.conclusion === 'NEUTRAL' || check.conclusion === 'neutral') {
    return <CircleDot className="h-3 w-3 text-zinc-500 shrink-0" />
  }
  // In progress / pending / queued
  if (check.status === 'IN_PROGRESS' || check.status === 'QUEUED' || check.status === 'PENDING' ||
      check.status === 'in_progress' || check.status === 'queued' || check.status === 'pending') {
    return <Loader2 className="h-3 w-3 text-yellow-400 animate-spin shrink-0" />
  }
  // Completed but no conclusion matched above
  if (check.status === 'COMPLETED' || check.status === 'completed') {
    return <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
  }
  return <CircleDot className="h-3 w-3 text-zinc-500 shrink-0" />
}

function ciCheckColor(check: CiCheck): string {
  if (check.conclusion === 'SUCCESS' || check.conclusion === 'success') return 'text-green-400'
  if (check.conclusion === 'FAILURE' || check.conclusion === 'failure' ||
      check.conclusion === 'TIMED_OUT' || check.conclusion === 'timed_out') return 'text-red-400'
  if (check.status === 'IN_PROGRESS' || check.status === 'QUEUED' || check.status === 'PENDING' ||
      check.status === 'in_progress' || check.status === 'queued' || check.status === 'pending') return 'text-yellow-400'
  if (check.conclusion === 'SKIPPED' || check.conclusion === 'skipped' ||
      check.conclusion === 'NEUTRAL' || check.conclusion === 'neutral') return 'text-zinc-500'
  return 'text-zinc-500'
}

function ciCheckLabel(check: CiCheck): string {
  if (check.conclusion) return check.conclusion.toLowerCase()
  return check.status.toLowerCase()
}

// --- Active Work Card ---

function ActiveWorkCard({ item }: { item: WorkItem }) {
  const prUrl = item.prUrl || item.detectedPrUrl
  const todoList = item.todoList || []
  const thoughts = item.thoughts || []
  const recentTools = item.recentTools || []
  const agentCount = item.agentCount || 0
  const todoDone = todoList.filter(t => t.status === 'completed').length
  const todoTotal = todoList.length
  const latestContext = item.contextHistory.length > 0
    ? item.contextHistory[item.contextHistory.length - 1]
    : 0
  const contextMax = 200_000
  const contextPercent = contextMax > 0 ? Math.min(100, (latestContext / contextMax) * 100) : 0

  // Extract repo and issue/PR number from key
  const keyParts = item.key.match(/^(.+?)#(\d+)$/)
  const repoName = item.repo || (keyParts ? keyParts[1] : item.key)
  const issueNumber = item.number || (keyParts ? parseInt(keyParts[2]) : null)
  const prNumber = prUrl ? prUrl.match(/\/pull\/(\d+)/)?.[1] : null

  return (
    <Card className="p-0 overflow-hidden">
      {/* === TOP ROW: Stats Bar === */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/60 border-b border-zinc-800/50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Duration</span>
            <span className="text-sm font-mono font-bold text-zinc-100 tabular-nums">
              <LiveDuration updatedAt={item.updatedAt} durationMs={item.durationMs} />
            </span>
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-2">
            <Hash className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Tokens</span>
            <span className="text-sm font-mono font-bold text-zinc-100 tabular-nums">
              <AnimatedNumber value={item.totalTokens} format={formatTokens} />
            </span>
          </div>
        </div>
      </div>

      {/* === REPO / ISSUE BAR === */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/50">
        <div className="flex items-center gap-3 min-w-0">
          <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
          <span className="font-mono text-sm font-semibold text-zinc-100 truncate">{repoName}</span>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono">
            {issueNumber && (
              <span>Issue: <span className="text-zinc-200">#{issueNumber}</span></span>
            )}
            {prNumber && (
              <>
                <span className="text-zinc-600">|</span>
                <a
                  href={prUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-400 hover:underline"
                >
                  PR: #{prNumber}
                </a>
              </>
            )}
          </div>
          {item.attempts > 1 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
              attempt {item.attempts}
            </Badge>
          )}
        </div>
        <button
          onClick={() => {
            if (confirm('Stop this worker?')) {
              fetch('/api/agents', { method: 'DELETE' }).then(() => {})
            }
          }}
          className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-3 py-1 rounded-md border border-red-500/20 transition-colors"
        >
          <Square className="h-3 w-3" />
          STOP
        </button>
      </div>

      {/* === MIDDLE ROW: 4 Metric Cards === */}
      <div className="grid grid-cols-4 gap-px bg-zinc-800/50">
        {/* Context */}
        <div className="bg-zinc-950 px-4 py-3">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Context</div>
          <div className="flex items-center gap-2">
            <ContextRing current={latestContext} max={contextMax} />
            <div>
              <div className="text-lg font-mono font-bold text-zinc-100 tabular-nums leading-tight">
                <AnimatedNumber value={latestContext} format={formatTokens} />
              </div>
              <div className="text-[10px] text-zinc-600 font-mono">{Math.round(contextPercent)}% used</div>
            </div>
          </div>
        </div>

        {/* Tasklist */}
        <div className="bg-zinc-950 px-4 py-3">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Tasklist</div>
          <div className="text-lg font-mono font-bold text-zinc-100 tabular-nums leading-tight">
            {todoTotal > 0 ? (
              <><AnimatedNumber value={todoDone} /><span className="text-zinc-500">/{todoTotal}</span></>
            ) : (
              <span className="text-zinc-600">--</span>
            )}
          </div>
          {todoTotal > 0 && (
            <div className="mt-1.5 h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500/60 rounded-full transition-all duration-500"
                style={{ width: `${(todoDone / todoTotal) * 100}%` }}
              />
            </div>
          )}
        </div>

        {/* Tools */}
        <div className="bg-zinc-950 px-4 py-3">
          <div className="flex items-center gap-1 text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
            <Wrench className="h-3 w-3" />
            Tools
          </div>
          <div className="text-lg font-mono font-bold text-zinc-100 tabular-nums leading-tight">
            <AnimatedNumber value={item.toolCalls} />
          </div>
        </div>

        {/* Agents */}
        <div className="bg-zinc-950 px-4 py-3">
          <div className="flex items-center gap-1 text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
            <Brain className="h-3 w-3" />
            Agents
          </div>
          <div className="text-lg font-mono font-bold text-zinc-100 tabular-nums leading-tight">
            <AnimatedNumber value={agentCount} />
          </div>
        </div>
      </div>

      {/* === BOTTOM ROW: 4 Columns === */}
      <div className="grid grid-cols-4 gap-px bg-zinc-800/50 min-h-[180px]">
        {/* Thought Log */}
        <div className="bg-zinc-950 flex flex-col">
          <div className="px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800/50 flex items-center gap-1.5">
            <MessageSquare className="h-3 w-3" />
            Thought Log
          </div>
          <ScrollArea className="flex-1 max-h-[300px]">
            <div className="p-2 space-y-1.5">
              {thoughts.length > 0 ? (
                [...thoughts].reverse().map((thought, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-2 rounded-md bg-zinc-900/50"
                  >
                    <span className="h-2 w-2 rounded-full bg-blue-400 shrink-0 mt-1.5" />
                    <div className="min-w-0">
                      <div className="text-[10px] text-zinc-600 mb-0.5">
                        Thought - {timeAgo(thought.timestamp)}
                      </div>
                      <p className="text-[11px] text-zinc-400 italic leading-relaxed line-clamp-2">
                        {thought.text}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center h-full text-zinc-700 text-[11px]">
                  No thoughts yet
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Todo List */}
        <div className="bg-zinc-950 flex flex-col">
          <div className="px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800/50 flex items-center gap-1.5">
            <Activity className="h-3 w-3" />
            Todo List
          </div>
          <ScrollArea className="flex-1 max-h-[300px]">
            <div className="p-2 space-y-1">
              {todoList.length > 0 ? (
                todoList.map((todo, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px]"
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${todoDotColor(todo.status)}`} />
                    <span className="text-zinc-500 text-[10px] font-mono w-10 shrink-0">{todoLabel(todo.status)}</span>
                    <span className={`truncate ${todo.status === 'completed' ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
                      {todo.content}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center h-full text-zinc-700 text-[11px]">
                  No tasks yet
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Tool Activity */}
        <div className="bg-zinc-950 flex flex-col">
          <div className="px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800/50 flex items-center gap-1.5">
            <Wrench className="h-3 w-3" />
            Tool Activity
          </div>
          <ScrollArea className="flex-1 max-h-[300px]">
            <div className="p-2 space-y-0.5">
              {recentTools.length > 0 ? (
                [...recentTools].reverse().map((tool, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-1 rounded-md text-[11px]"
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${toolDotColor(tool.status)}`} />
                    <span className="font-mono text-zinc-400 shrink-0">{tool.name}</span>
                    <span className="text-zinc-600 truncate">{tool.label}</span>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center h-full text-zinc-700 text-[11px]">
                  No tool calls yet
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* CI Checks */}
        <div className="bg-zinc-950 flex flex-col">
          <div className="px-3 py-2 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800/50 flex items-center gap-1.5">
            <Shield className="h-3 w-3" />
            CI Checks
          </div>
          <ScrollArea className="flex-1 max-h-[300px]">
            <div className="p-2 space-y-0.5">
              {(item.ciChecks && item.ciChecks.length > 0) ? (
                item.ciChecks.map((check, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-1 rounded-md text-[11px]"
                  >
                    {ciCheckIcon(check)}
                    <span className="font-mono text-zinc-400 truncate">{check.name}</span>
                    <span className={`text-[10px] font-mono shrink-0 ${ciCheckColor(check)}`}>
                      {ciCheckLabel(check)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center h-full text-zinc-700 text-[11px]">
                  {prUrl ? 'No checks yet' : 'No PR'}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </Card>
  )
}

// --- Open Issues helper components ---

function OpenIssueCiCell({ ci }: { ci: 'passing' | 'failing' | 'pending' | 'none' | null }) {
  if (!ci || ci === 'none') return <span className="text-zinc-700">&mdash;</span>
  switch (ci) {
    case 'passing':
      return <CheckCircle2 className="h-4 w-4 text-green-400" />
    case 'failing':
      return <XCircle className="h-4 w-4 text-red-400" />
    case 'pending':
      return <Loader2 className="h-4 w-4 text-yellow-400 animate-spin" />
  }
}

function OpenIssueReviewCell({ review }: { review: string | null }) {
  if (!review) return <span className="text-zinc-700">&mdash;</span>
  switch (review) {
    case 'APPROVED':
      return <span className="text-xs text-green-400 font-medium">Approved</span>
    case 'CHANGES_REQUESTED':
      return <span className="text-xs text-red-400 font-medium">Changes Requested</span>
    case 'REVIEW_REQUIRED':
      return <span className="text-xs text-yellow-400 font-medium">Review Required</span>
    default:
      return <span className="text-zinc-700">&mdash;</span>
  }
}

function OpenIssueStatusBadge({ status }: { status: OpenIssue['status'] }) {
  const config: Record<string, { label: string; className: string }> = {
    no_pr: { label: 'No PR', className: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
    ci_pending: { label: 'CI Pending', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    ci_failing: { label: 'CI Failing', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    changes_requested: { label: 'Changes Requested', className: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
    ready_to_merge: { label: 'Ready to Merge', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
    merged: { label: 'Merged', className: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  }
  const c = config[status] || config.no_pr
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${c.className}`}>
      {c.label}
    </Badge>
  )
}
