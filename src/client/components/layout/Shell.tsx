import { useState, useCallback, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { Zap, LayoutDashboard, FolderGit2, Clock, BarChart3, Maximize, Minimize, ArrowUpCircle, Loader2 } from 'lucide-react'
import { AgentIndicator } from '@/components/agents/AgentIndicator'
import { MaintenanceToggle } from '@/components/layout/MaintenanceToggle'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/projects', label: 'Repos', icon: FolderGit2 },
  { to: '/crons', label: 'Crons', icon: Clock },
  { to: '/usage', label: 'Usage', icon: BarChart3 },
]

interface VersionInfo {
  current: string
  latest: string | null
  updateAvailable: boolean
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)
  const { data: version } = useStore<VersionInfo>('/version', () => api.get('/version'), { ttl: 10 * 60_000 })
  const [updating, setUpdating] = useState(false)

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen()
    }
  }, [])

  const handleUpdate = useCallback(async () => {
    setUpdating(true)
    try {
      await api.post('/version/update', {})
      // Server will restart — poll until it comes back
      const poll = setInterval(async () => {
        try {
          await api.get('/version')
          clearInterval(poll)
          window.location.reload()
        } catch { /* still restarting */ }
      }, 2000)
    } catch {
      setUpdating(false)
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 h-12 border-b bg-zinc-950/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            <span className="font-bold text-sm">UltraDev</span>
            {version && (
              <span className="text-[10px] text-zinc-600 font-mono">{version.current}</span>
            )}
          </div>
          <nav className="flex items-center gap-1">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                  )
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {version?.updateAvailable && (
            <button
              onClick={handleUpdate}
              disabled={updating}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
                updating
                  ? 'bg-blue-500/20 text-blue-400 cursor-wait'
                  : 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 hover:text-blue-300'
              )}
            >
              {updating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowUpCircle className="h-3 w-3" />
              )}
              {updating ? 'Updating...' : `Update to ${version.latest}`}
            </button>
          )}
          {version?.updateAvailable && <div className="w-px h-5 bg-zinc-800" />}
          <MaintenanceToggle />
          <div className="w-px h-5 bg-zinc-800" />
          <AgentIndicator />
          <div className="w-px h-5 bg-zinc-800" />
          <button
            onClick={toggleFullscreen}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-auto p-4">{children}</main>
    </div>
  )
}
