import { readFileSync, existsSync, statSync } from 'fs'

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface ThoughtEntry {
  text: string
  timestamp: number  // ms since log file start
}

export interface LogStats {
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
  recentTools: { name: string; label: string; status: 'done' | 'running' }[]
  lastThinking: string | null      // latest text from the agent
  currentTool: string | null        // tool currently executing (no result yet)
  lastActivityMs: number | null     // timestamp of last parsed event
  detectedPrUrl: string | null      // PR URL found in agent output
  todoList: TodoItem[]              // latest todo list from TodoWrite
  thoughts: ThoughtEntry[]          // recent thought log entries
  agentCount: number                // number of spawned sub-agents
}

// Cache: logFile -> { mtimeMs, stats }
const statsCache = new Map<string, { mtimeMs: number; final: boolean; stats: LogStats }>()

export function parseLogStats(logFile: string): LogStats {
  const empty: LogStats = {
    toolCalls: 0, costUsd: null, durationMs: null, numTurns: null,
    inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
    totalTokens: 0, peakContext: 0, contextHistory: [], recentTools: [],
    lastThinking: null, currentTool: null, lastActivityMs: null, detectedPrUrl: null,
    todoList: [], thoughts: [], agentCount: 0,
  }
  if (!logFile || !existsSync(logFile)) return empty

  // Check cache
  try {
    const fstat = statSync(logFile)
    const cached = statsCache.get(logFile)
    if (cached) {
      // If final result was found, never re-parse
      if (cached.final) return cached.stats
      // If file hasn't changed, return cached
      if (cached.mtimeMs === fstat.mtimeMs) return cached.stats
    }

    const stats: LogStats = {
      ...empty,
      contextHistory: [],
      recentTools: [],
      todoList: [],
      thoughts: [],
    }
    const content = readFileSync(logFile, 'utf-8')
    const lines = content.trim().split('\n')
    let hasFinalResult = false
    const pendingToolIds = new Set<string>()
    const logStartMs = fstat.birthtimeMs || fstat.ctimeMs
    let eventIndex = 0

    for (const line of lines) {
      try {
        const event = JSON.parse(line)
        eventIndex++

        if (event.type === 'assistant' && event.message) {
          stats.lastActivityMs = Date.now()
          if (event.message.content) {
            for (const block of event.message.content) {
              if (block.type === 'tool_use') {
                stats.toolCalls++
                const label = toolShortLabel(block.name, block.input)
                stats.recentTools.push({ name: block.name, label, status: 'running' })
                pendingToolIds.add(block.id)
                stats.currentTool = `${block.name} ${label}`

                // Track TodoWrite calls for todo list
                if (block.name === 'TodoWrite' && block.input?.todos && Array.isArray(block.input.todos)) {
                  stats.todoList = block.input.todos.map((t: any) => ({
                    content: truncStr(String(t.content || ''), 100),
                    status: t.status === 'completed' ? 'completed' : t.status === 'in_progress' ? 'in_progress' : 'pending',
                  }))
                }

                // Agent spawns tracked via task_started events below
              }
              const blockText = block.text || block.thinking
              if ((block.type === 'text' || block.type === 'thinking') && blockText?.trim()) {
                stats.lastThinking = truncStr(blockText.trim(), 200)
                // Add to thought log with approximate timestamp
                const approxTs = logStartMs + (eventIndex / lines.length) * (fstat.mtimeMs - logStartMs)
                stats.thoughts.push({
                  text: truncStr(blockText.trim(), 150),
                  timestamp: Math.round(approxTs),
                })
                // Check for PR URLs in text
                const prMatch = blockText.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/)
                if (prMatch) stats.detectedPrUrl = prMatch[0]
              }
            }
          }

          const usage = event.message.usage
          if (usage) {
            stats.inputTokens += usage.input_tokens || 0
            stats.outputTokens += usage.output_tokens || 0
            stats.cacheCreationTokens += usage.cache_creation_input_tokens || 0
            stats.cacheReadTokens += usage.cache_read_input_tokens || 0

            const contextSize = (usage.input_tokens || 0) +
              (usage.cache_read_input_tokens || 0) +
              (usage.cache_creation_input_tokens || 0)
            if (contextSize > stats.peakContext) stats.peakContext = contextSize
            stats.contextHistory.push(contextSize)
          }
        }

        // Track task_started for agent sub-tasks
        if (event.type === 'system' && event.subtype === 'task_started') {
          stats.agentCount++
        }

        if (event.type === 'result' && event.subtype === 'tool_result') {
          // Tool finished — mark as done and clear current tool
          const last = [...pendingToolIds].pop()
          if (last) pendingToolIds.delete(last)
          if (pendingToolIds.size === 0) stats.currentTool = null
          // Mark the most recent running tool as done
          for (let i = stats.recentTools.length - 1; i >= 0; i--) {
            if (stats.recentTools[i].status === 'running') {
              stats.recentTools[i].status = 'done'
              break
            }
          }
          stats.lastActivityMs = Date.now()
          // Check tool output for PR URLs
          if (typeof event.content === 'string') {
            const prMatch = event.content.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/)
            if (prMatch) stats.detectedPrUrl = prMatch[0]
          }
        }

        if (event.type === 'result' && event.subtype !== 'tool_result') {
          hasFinalResult = true
          if (event.total_cost_usd !== undefined) stats.costUsd = event.total_cost_usd
          else if (event.cost_usd !== undefined) stats.costUsd = event.cost_usd
          if (event.duration_ms !== undefined) stats.durationMs = event.duration_ms
          if (event.num_turns !== undefined) stats.numTurns = event.num_turns
          if (typeof event.result === 'string') {
            const prMatch = event.result.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/)
            if (prMatch) stats.detectedPrUrl = prMatch[0]
          }
        }
      } catch { /* skip unparseable lines */ }
    }

    stats.totalTokens = stats.inputTokens + stats.outputTokens +
      stats.cacheCreationTokens + stats.cacheReadTokens

    // If log is finalized, mark all remaining running tools as done
    if (hasFinalResult) {
      for (const tool of stats.recentTools) {
        if (tool.status === 'running') tool.status = 'done'
      }
    }

    // Keep only last 10 tool calls for display
    if (stats.recentTools.length > 10) {
      stats.recentTools = stats.recentTools.slice(-10)
    }

    // Keep only last 8 thoughts for display
    if (stats.thoughts.length > 8) {
      stats.thoughts = stats.thoughts.slice(-8)
    }

    // De-dup agent count: task_started fires for each Agent tool, so only count those
    // (the Agent tool_use increment was removed; we track via task_started only)

    if (stats.durationMs === null) {
      try {
        const created = fstat.birthtimeMs || fstat.ctimeMs
        const modified = fstat.mtimeMs
        if (modified > created) stats.durationMs = Math.round(modified - created)
      } catch { /* ok */ }
    }

    if (stats.numTurns === null && stats.contextHistory.length > 0) {
      stats.numTurns = stats.contextHistory.length
    }

    // Cache it
    statsCache.set(logFile, { mtimeMs: fstat.mtimeMs, final: hasFinalResult, stats })

    return stats
  } catch { return empty }
}

function toolShortLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return shortPath(input.file_path as string)
    case 'Edit': return shortPath(input.file_path as string)
    case 'Write': return shortPath(input.file_path as string)
    case 'Bash': return truncStr(input.description as string || input.command as string || 'bash', 50)
    case 'Grep': return `"${truncStr(input.pattern as string || '', 30)}"`
    case 'Glob': return `"${truncStr(input.pattern as string || '', 30)}"`
    default: return name
  }
}

function shortPath(p: string | undefined): string {
  if (!p) return '(unknown)'
  const parts = p.split('/')
  return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : p
}

function truncStr(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '...' : s
}
