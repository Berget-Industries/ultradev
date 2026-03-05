import { useState } from 'react'
import { Terminal, FileText, SquareTerminal, Search, Pencil, FileCode, ChevronDown, ChevronRight } from 'lucide-react'

// --- Stream-JSON event types ---

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

interface TextBlock {
  type: 'text'
  text: string
}

type ContentBlock = ToolUseBlock | TextBlock

interface AssistantEvent {
  type: 'assistant'
  message: {
    content: ContentBlock[]
  }
}

interface ResultEvent {
  type: 'result'
  subtype?: string
  result?: string
  content?: string
  cost_usd?: number
  duration_ms?: number
  duration_api_ms?: number
  num_turns?: number
}

type StreamEvent = AssistantEvent | ResultEvent | { type: string; [k: string]: unknown }

// --- Parsed display items ---

export interface TextItem {
  kind: 'text'
  text: string
}

export interface ToolCallItem {
  kind: 'tool'
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
}

export interface SummaryItem {
  kind: 'summary'
  result?: string
  cost?: number
  duration?: number
  turns?: number
}

export type DisplayItem = TextItem | ToolCallItem | SummaryItem

export function parseStreamJson(raw: string): DisplayItem[] | null {
  const lines = raw.trim().split('\n').filter(Boolean)
  const items: DisplayItem[] = []
  const pendingTools = new Map<string, ToolCallItem>()
  let parsed = false

  for (const line of lines) {
    let event: StreamEvent
    try {
      event = JSON.parse(line)
      parsed = true
    } catch {
      continue
    }

    if (event.type === 'assistant' && 'message' in event) {
      const msg = (event as AssistantEvent).message
      for (const block of msg.content) {
        if (block.type === 'text' && block.text.trim()) {
          items.push({ kind: 'text', text: block.text })
        } else if (block.type === 'tool_use') {
          const tool: ToolCallItem = { kind: 'tool', id: block.id, name: block.name, input: block.input }
          items.push(tool)
          pendingTools.set(block.id, tool)
        }
      }
    } else if (event.type === 'result') {
      const r = event as ResultEvent
      if (r.subtype === 'tool_result' && r.content) {
        // Try to match to the most recent pending tool
        const last = [...pendingTools.values()].pop()
        if (last) {
          last.result = typeof r.content === 'string' ? r.content : JSON.stringify(r.content)
          pendingTools.delete(last.id)
        }
      } else if (!r.subtype) {
        items.push({
          kind: 'summary',
          result: r.result,
          cost: r.cost_usd,
          duration: r.duration_ms,
          turns: r.num_turns,
        })
      }
    }
  }

  return parsed ? items : null
}

// --- TodoWrite extraction ---

export interface TodoItem {
  id: string
  content: string
  status: 'completed' | 'in_progress' | 'pending'
  priority?: string
  activeForm?: string
}

/** Extract the last TodoWrite call's todos from raw stream-json log content. */
export function extractTodos(raw: string): TodoItem[] {
  const lines = raw.trim().split('\n').filter(Boolean)
  let lastTodos: TodoItem[] = []

  for (const line of lines) {
    let event: StreamEvent
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }

    if (event.type === 'assistant' && 'message' in event) {
      const msg = (event as AssistantEvent).message
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.name === 'TodoWrite') {
          const input = block.input as { todos?: TodoItem[] }
          if (Array.isArray(input.todos)) {
            lastTodos = input.todos.map(t => ({
              id: t.id || '',
              content: t.content || '',
              status: (['completed', 'in_progress', 'pending'].includes(t.status) ? t.status : 'pending') as TodoItem['status'],
              priority: t.priority,
              activeForm: t.activeForm,
            }))
          }
        }
      }
    }
  }

  return lastTodos
}

// --- Tool display helpers ---

export function toolIcon(name: string) {
  switch (name) {
    case 'Read': return <FileText className="h-3.5 w-3.5 text-blue-400" />
    case 'Edit': return <Pencil className="h-3.5 w-3.5 text-yellow-400" />
    case 'Write': return <FileCode className="h-3.5 w-3.5 text-green-400" />
    case 'Bash': return <SquareTerminal className="h-3.5 w-3.5 text-orange-400" />
    case 'Grep':
    case 'Glob': return <Search className="h-3.5 w-3.5 text-purple-400" />
    default: return <Terminal className="h-3.5 w-3.5 text-zinc-400" />
  }
}

export function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return `Read ${shortPath(input.file_path as string)}`
    case 'Edit': return `Edit ${shortPath(input.file_path as string)}`
    case 'Write': return `Write ${shortPath(input.file_path as string)}`
    case 'Bash': return truncate(input.command as string || input.description as string || 'bash', 60)
    case 'Grep': return `Grep "${truncate(input.pattern as string || '', 30)}"`
    case 'Glob': return `Glob "${truncate(input.pattern as string || '', 30)}"`
    default: return name
  }
}

export function shortPath(p: string | undefined): string {
  if (!p) return '(unknown)'
  // Show last 2 segments
  const parts = p.split('/')
  return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : p
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '...' : s
}

export function formatInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return input.file_path as string || ''
    case 'Write': return `${input.file_path}\n\n${truncate(input.content as string || '', 500)}`
    case 'Edit': return `${input.file_path}\n\n- ${truncate(input.old_string as string || '', 200)}\n+ ${truncate(input.new_string as string || '', 200)}`
    case 'Bash': return input.command as string || ''
    case 'Grep': return `pattern: ${input.pattern}\npath: ${input.path || '.'}\nglob: ${input.glob || '*'}`
    case 'Glob': return `pattern: ${input.pattern}\npath: ${input.path || '.'}`
    default: return JSON.stringify(input, null, 2)
  }
}

// --- Tool call card ---

export function ToolCard({ item }: { item: ToolCallItem }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-zinc-800 rounded-md overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-900/80 hover:bg-zinc-800/80 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3 w-3 text-zinc-500 shrink-0" /> : <ChevronRight className="h-3 w-3 text-zinc-500 shrink-0" />}
        {toolIcon(item.name)}
        <span className="text-xs font-mono text-zinc-300 truncate">
          {toolLabel(item.name, item.input)}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-zinc-800">
          {/* Input */}
          <div className="px-3 py-2 bg-zinc-950/50">
            <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Input</div>
            <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-words max-h-40 overflow-auto">
              {formatInput(item.name, item.input)}
            </pre>
          </div>
          {/* Result */}
          {item.result && (
            <div className="px-3 py-2 bg-zinc-950/30 border-t border-zinc-800/50">
              <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Output</div>
              <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-words max-h-60 overflow-auto">
                {truncate(item.result, 3000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --- Main LogContent component ---

interface LogContentProps {
  raw: string
}

export function LogContent({ raw }: LogContentProps) {
  const items = parseStreamJson(raw)
  const isRich = items !== null && items.length > 0

  if (!raw) {
    return <span className="text-zinc-600 italic text-sm">No log data available.</span>
  }

  if (isRich) {
    return (
      <div className="space-y-3">
        {items.map((item, i) => {
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
        })}
        <div className="text-xs text-zinc-500 pt-2">
          {items.filter(i => i.kind === 'tool').length} tool calls
        </div>
      </div>
    )
  }

  // Plain text fallback
  return (
    <div className="font-mono text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap break-words">
      {raw}
    </div>
  )
}
