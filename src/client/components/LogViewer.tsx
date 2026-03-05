import { useEffect, useRef, useState } from 'react'
import { X, Terminal, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { parseStreamJson, ToolCard, truncate, type DisplayItem } from '@/components/LogContent'

interface LogViewerProps {
  issueKey: string
  status: string
  onClose: () => void
}

export function LogViewer({ issueKey, status, onClose }: LogViewerProps) {
  const [raw, setRaw] = useState('')
  const [live, setLive] = useState(status === 'in_progress')
  const [finalStatus, setFinalStatus] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    const encoded = encodeURIComponent(issueKey)

    if (status !== 'in_progress') {
      fetch(`/api/logs/${encoded}/full`)
        .then(r => r.ok ? r.text() : Promise.reject('Not found'))
        .then(setRaw)
        .catch(() => setRaw('(No log data available)'))
      setLive(false)
      return
    }

    const es = new EventSource(`/api/logs/${encoded}`)

    es.onmessage = (e) => {
      const chunk = JSON.parse(e.data) as string
      setRaw(prev => prev + chunk)
    }

    es.addEventListener('done', (e) => {
      const data = JSON.parse(e.data)
      setFinalStatus(data.status)
      setLive(false)
      es.close()
    })

    es.onerror = () => {
      setLive(false)
      es.close()
    }

    return () => es.close()
  }, [issueKey, status])

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [raw, autoScroll])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 80)
  }

  // Try to parse as stream-json, fallback to plain text
  const items = parseStreamJson(raw)
  const isRich = items !== null && items.length > 0

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />

      <div className="fixed right-0 top-0 bottom-0 w-full max-w-3xl z-50 flex flex-col bg-zinc-950 border-l border-zinc-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
          <div className="flex items-center gap-3 min-w-0">
            <Terminal className="h-4 w-4 text-zinc-400 shrink-0" />
            <code className="text-sm font-mono text-zinc-200 truncate">{issueKey}</code>
            {live && (
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 gap-1" variant="outline">
                <Loader2 className="h-3 w-3 animate-spin" />
                live
              </Badge>
            )}
            {finalStatus && (
              <Badge className={cn(
                'border',
                finalStatus === 'done' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                finalStatus === 'failed' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
              )} variant="outline">
                {finalStatus}
              </Badge>
            )}
            {isRich && (
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30" variant="outline">
                rich
              </Badge>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto p-4 space-y-3"
        >
          {!raw && (
            <span className="text-zinc-600 italic text-sm">Waiting for output...</span>
          )}

          {isRich ? (
            // Rich structured view
            (items as DisplayItem[]).map((item, i) => {
              if (item.kind === 'text') {
                return (
                  <div key={i} className="text-sm text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">
                    {item.text}
                  </div>
                )
              }
              if (item.kind === 'tool') {
                return <ToolCard key={item.id || i} item={item} />
              }
              if (item.kind === 'summary') {
                return (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-md bg-zinc-900/50 border border-zinc-800 text-xs text-zinc-400">
                    {item.turns && <span>{item.turns} turns</span>}
                    {item.duration && <span>{(item.duration / 1000).toFixed(1)}s</span>}
                    {item.cost !== undefined && <span>${item.cost.toFixed(4)}</span>}
                    {item.result && <span className="text-zinc-300 truncate">{truncate(item.result, 100)}</span>}
                  </div>
                )
              }
              return null
            })
          ) : (
            // Plain text fallback
            raw && (
              <div className="font-mono text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap break-words">
                {raw}
              </div>
            )
          )}
          <div ref={bottomRef} />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/80 flex items-center justify-between text-xs text-zinc-500">
          <span>
            {isRich
              ? `${(items as DisplayItem[]).filter(i => i.kind === 'tool').length} tool calls`
              : `${raw.split('\n').length} lines`
            }
          </span>
          {live && (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
              Streaming...
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
