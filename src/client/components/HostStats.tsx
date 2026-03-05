import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Card } from '@/components/ui/card'

interface StatsData {
  cpu: { percent: number; cores: number }
  memory: { total: number; used: number; free: number; percent: number }
  load: { '1m': number; '5m': number; '15m': number }
  uptime: number
  platform: string
  hostname: string
}

function ringColor(percent: number): string {
  if (percent > 80) return '#ef4444'   // red-500
  if (percent > 50) return '#eab308'   // yellow-500
  return '#22c55e'                      // green-500
}

function formatBytes(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1)
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  return `${hours}h`
}

function StatRing({ percent, label, subtitle }: { percent: number; label: string; subtitle: string }) {
  const size = 50
  const stroke = 5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - percent / 100)
  const color = ringColor(percent)

  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        {/* Track */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272a" strokeWidth={stroke} />
        {/* Fill */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-all duration-500"
        />
        {/* Center text */}
        <text
          x={size / 2} y={size / 2}
          textAnchor="middle" dominantBaseline="central"
          fill="white" fontSize="12" fontFamily="monospace" fontWeight="bold"
        >
          {percent}%
        </text>
      </svg>
      <div>
        <div className="text-[11px] text-zinc-500 uppercase tracking-wider">{label}</div>
        <div className="text-[10px] text-zinc-600">{subtitle}</div>
      </div>
    </div>
  )
}

export function HostStats() {
  const [stats, setStats] = useState<StatsData | null>(null)

  useEffect(() => {
    const poll = () => api.get<StatsData>('/stats').then(setStats).catch(() => {})
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  if (!stats) return null

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">System Health</span>
        <span className="text-[10px] text-zinc-600">{stats.hostname}</span>
      </div>
      <div className="flex items-center gap-8 flex-wrap">
        {/* CPU ring */}
        <StatRing
          percent={stats.cpu.percent}
          label="CPU"
          subtitle={`${stats.cpu.cores} cores`}
        />

        {/* RAM ring */}
        <StatRing
          percent={stats.memory.percent}
          label="RAM"
          subtitle={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)} GB`}
        />

        {/* Load — text only */}
        <div>
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Load</div>
          <div className="text-lg font-mono font-bold">{stats.load['1m'].toFixed(2)}</div>
          <div className="text-[10px] text-zinc-600">1m avg</div>
        </div>

        {/* Uptime — text only */}
        <div>
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Uptime</div>
          <div className="text-lg font-mono font-bold">{formatUptime(stats.uptime)}</div>
          <div className="text-[10px] text-zinc-600">{stats.platform}</div>
        </div>
      </div>
    </Card>
  )
}
