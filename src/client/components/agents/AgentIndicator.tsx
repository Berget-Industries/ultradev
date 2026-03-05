import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import { api } from '@/lib/api'

interface AgentStatus {
  running: boolean
  count: number
  agents: { pid: number; command: string; cwd: string; uptime: string }[]
}

export function AgentIndicator() {
  const [status, setStatus] = useState<AgentStatus>({ running: false, count: 0, agents: [] })

  useEffect(() => {
    const poll = () => api.get<AgentStatus>('/agents').then(setStatus).catch(() => {})
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
      <div className="relative">
        <Bot className="h-4 w-4" />
        <span
          className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${
            status.running ? 'bg-green-500 animate-pulse' : 'bg-zinc-600'
          }`}
        />
      </div>
      <span>
        {status.running
          ? `${status.count} agent${status.count > 1 ? 's' : ''} running`
          : 'No agents'}
      </span>
    </div>
  )
}
