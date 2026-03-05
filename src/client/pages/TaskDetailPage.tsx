import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, AlertCircle, Loader2, CheckCircle2, Circle, ListTodo, Wrench, Clock, Zap, DollarSign, RotateCcw, Hash } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LogContent, extractTodos } from '@/components/LogContent'
import { api } from '@/lib/api'

interface QueueItem {
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
  numTurns: number | null
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  peakContext: number
  contextHistory: number[]
}

function statusColor(status: string): string {
  switch (status) {
    case 'done': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'in_progress': return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'awaiting_ci': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'failed': return 'bg-red-500/20 text-red-400 border-red-500/30'
    default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '--'
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}

function formatCost(usd: number | null): string {
  if (usd === null) return '--'
  return `$${usd.toFixed(4)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const CONTEXT_LIMIT = 200_000

function ContextRing({ peak }: { peak: number }) {
  const pct = Math.min(peak / CONTEXT_LIMIT, 1)
  const size = 36
  const stroke = 4
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - pct)
  const color = pct > 0.8 ? '#ef4444' : pct > 0.5 ? '#eab308' : '#3b82f6'

  return (
    <div className="flex items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272a" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div>
        <div className="text-base font-mono font-bold leading-none">{formatTokens(peak)}</div>
        <div className="text-[9px] text-zinc-500">/ 200K</div>
      </div>
    </div>
  )
}

export default function TaskDetailPage() {
  const { key } = useParams<{ key: string }>()
  const [item, setItem] = useState<QueueItem | null>(null)
  const [logContent, setLogContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [logLoading, setLogLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const logBottomRef = useRef<HTMLDivElement>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const encodedKey = key ? encodeURIComponent(decodeURIComponent(key)) : ''

  const fetchItem = useCallback(() => {
    if (!encodedKey) return
    api.get<QueueItem>(`/orchestrator/queue/${encodedKey}`)
      .then((data) => {
        setItem(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message || 'Failed to load task details')
        setLoading(false)
      })
  }, [encodedKey])

  // Poll item stats every 5s
  useEffect(() => {
    fetchItem()
    const id = setInterval(fetchItem, 5_000)
    return () => clearInterval(id)
  }, [fetchItem])

  // Log: SSE for live tasks, full fetch for completed — re-evaluate when status changes
  useEffect(() => {
    if (!encodedKey || !item) return

    const isLive = item.status === 'in_progress'
    setLive(isLive)

    // Close any previous SSE connection
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    if (!isLive) {
      // One-shot fetch for completed tasks
      fetch(`/api/logs/${encodedKey}/full`)
        .then(r => r.ok ? r.text() : Promise.reject('Not found'))
        .then((raw) => { setLogContent(raw); setLogLoading(false) })
        .catch(() => { setLogContent(''); setLogLoading(false) })
      return
    }

    // SSE for live tasks
    setLogContent('')
    setLogLoading(false)
    const es = new EventSource(`/api/logs/${encodedKey}`)
    esRef.current = es

    es.onmessage = (e) => {
      const chunk = JSON.parse(e.data) as string
      setLogContent(prev => prev + chunk)
    }

    es.addEventListener('done', () => {
      setLive(false)
      es.close()
      esRef.current = null
      fetchItem() // refresh stats one final time
    })

    es.onerror = () => {
      setLive(false)
      es.close()
      esRef.current = null
    }

    return () => { es.close(); esRef.current = null }
  }, [encodedKey, item?.status])

  const todos = useMemo(() => extractTodos(logContent), [logContent])

  // Auto-scroll log to bottom when new content arrives
  useEffect(() => {
    if (autoScroll && logBottomRef.current) {
      logBottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logContent, autoScroll])

  const handleLogScroll = () => {
    if (!logContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 80)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading task...
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="space-y-4">
        <Link to="/queue" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Queue
        </Link>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="h-5 w-5" />
              <span>{error || 'Task not found'}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const contextPct = item.peakContext > 0 ? Math.round((item.peakContext / CONTEXT_LIMIT) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/queue" className="text-zinc-400 hover:text-zinc-200 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-lg font-bold font-mono">{item.key}</h1>
        <Badge className={statusColor(item.status)} variant="outline">
          {live && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
          {item.status}
        </Badge>
        <Badge variant="secondary" className="text-xs">{item.type}</Badge>
        {item.repo && item.number && (
          <a href={`https://github.com/${item.repo}/issues/${item.number}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
            Issue #{item.number} <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {item.prUrl && (
          <a href={item.prUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
            PR #{item.prUrl.match(/\/pull\/(\d+)/)?.[1] || ''} <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {item.error && (
          <span className="text-xs text-red-400 truncate max-w-xs" title={item.error}>
            <AlertCircle className="h-3 w-3 inline mr-1" />{item.error}
          </span>
        )}
      </div>

      {/* Compact stat strip */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <Card className="p-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Wrench className="h-3 w-3 text-zinc-500" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Tools</span>
          </div>
          <div className="text-base font-mono font-bold">{item.toolCalls}</div>
        </Card>
        <Card className="p-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <DollarSign className="h-3 w-3 text-zinc-500" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Cost</span>
          </div>
          <div className="text-base font-mono font-bold">{formatCost(item.costUsd)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Clock className="h-3 w-3 text-zinc-500" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Duration</span>
          </div>
          <div className="text-base font-mono font-bold">{formatDuration(item.durationMs)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Hash className="h-3 w-3 text-zinc-500" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Turns</span>
          </div>
          <div className="text-base font-mono font-bold">{item.numTurns ?? '--'}</div>
        </Card>
        <Card className="p-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Zap className="h-3 w-3 text-zinc-500" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Tokens</span>
          </div>
          <div className="text-base font-mono font-bold">{formatTokens(item.totalTokens)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <RotateCcw className="h-3 w-3 text-zinc-500" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Input</span>
          </div>
          <div className="text-base font-mono font-bold">{formatTokens(item.inputTokens + item.cacheReadTokens)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Zap className="h-3 w-3 text-zinc-500" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Output</span>
          </div>
          <div className="text-base font-mono font-bold">{formatTokens(item.outputTokens)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Context</span>
          </div>
          <div className="flex items-center gap-2">
            <ContextRing peak={item.peakContext} />
          </div>
        </Card>
      </div>

      {/* Tasks + Log section */}
      {todos.length > 0 ? (
        <div className="grid grid-cols-5 gap-3">
          <div className="col-span-1">
            <Card className="h-full">
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center gap-2">
                  <ListTodo className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-sm font-semibold">Tasks</span>
                  <span className="text-[10px] text-zinc-500 ml-auto">
                    {todos.filter(t => t.status === 'completed').length}/{todos.length}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <ul className="space-y-1">
                  {todos.map((todo) => (
                    <li key={todo.id} className="flex items-start gap-2 py-0.5">
                      {todo.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />}
                      {todo.status === 'in_progress' && <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin mt-0.5 shrink-0" />}
                      {todo.status === 'pending' && <Circle className="h-3.5 w-3.5 text-zinc-600 mt-0.5 shrink-0" />}
                      <span className={`text-xs leading-tight ${
                        todo.status === 'completed' ? 'text-zinc-500 line-through'
                          : todo.status === 'in_progress' ? 'text-zinc-200' : 'text-zinc-400'
                      }`}>
                        {todo.content}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
          <div className="col-span-4">
            <Card>
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">Log Output</span>
                  {live && (
                    <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 gap-1 text-[10px] px-1.5 py-0" variant="outline">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      live
                    </Badge>
                  )}
                  <span className="text-[10px] text-zinc-500 ml-auto">{item.toolCalls} tool calls</span>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div ref={logContainerRef} onScroll={handleLogScroll} className="max-h-[600px] overflow-y-auto">
                  {logLoading ? (
                    <div className="text-sm text-zinc-500 italic">Loading log...</div>
                  ) : (
                    <LogContent raw={logContent} />
                  )}
                  <div ref={logBottomRef} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader className="p-3 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Log Output</span>
              {live && (
                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 gap-1 text-[10px] px-1.5 py-0" variant="outline">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  live
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div ref={logContainerRef} onScroll={handleLogScroll} className="max-h-[600px] overflow-y-auto">
              {logLoading ? (
                <div className="text-sm text-zinc-500 italic">Loading log...</div>
              ) : (
                <LogContent raw={logContent} />
              )}
              <div ref={logBottomRef} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
