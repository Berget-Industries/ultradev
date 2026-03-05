import { useEffect, useState } from 'react'
import { Power } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface MaintenanceStatus {
  enabled: boolean
}

export function MaintenanceToggle() {
  const [maintenance, setMaintenance] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const poll = () =>
      api
        .get<MaintenanceStatus>('/maintenance')
        .then((data) => setMaintenance(data.enabled))
        .catch(() => {})
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  const isOnline = !maintenance

  async function toggle() {
    if (isOnline) {
      const confirmed = window.confirm(
        'This will stop all active work. No polling, no new tasks. Continue?'
      )
      if (!confirmed) return
    }

    setLoading(true)
    try {
      const data = await api.post<MaintenanceStatus>('/maintenance', {
        enabled: !maintenance,
      })
      setMaintenance(data.enabled)
    } catch (err) {
      console.error('Failed to toggle maintenance mode:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-1.5">
        <Power
          className={cn(
            'h-3.5 w-3.5',
            isOnline ? 'text-green-500' : 'text-red-500'
          )}
        />
        <span className="text-xs font-medium text-zinc-400">System</span>
      </div>
      <Switch
        checked={isOnline}
        onCheckedChange={toggle}
        disabled={loading}
        className={cn(
          isOnline ? 'bg-green-600' : 'bg-red-600'
        )}
      />
      <span
        className={cn(
          'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
          isOnline
            ? 'text-green-400 bg-green-500/10'
            : 'text-red-400 bg-red-500/10'
        )}
      >
        {isOnline ? 'ONLINE' : 'MAINTENANCE'}
      </span>
    </div>
  )
}
