import { useState } from 'react'
import { Plus, Clock, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { CronjobForm, type Cronjob } from '@/components/cronjobs/CronjobForm'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'

interface Job {
  name: string
  schedule: string
  lastRun: number | null
  status: string
  enabled?: boolean
}

interface OrchestratorState {
  jobs: Job[]
  config?: { pollIntervalMs?: number }
}

function statusColor(status: string): string {
  switch (status) {
    case 'active':
    case 'idle': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'polling': return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'paused': return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
    case 'error': return 'bg-red-500/20 text-red-400 border-red-500/30'
    default: return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
  }
}

function formatTime(ts: number | string | null): string {
  if (!ts) return '—'
  if (typeof ts === 'number') return new Date(ts).toLocaleTimeString()
  return ts
}

// Unified row type
interface CronRow {
  id: string
  name: string
  schedule: string
  status: string
  lastRun: string
  system: boolean
  enabled?: boolean
  cronjob?: Cronjob
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

export default function CronjobsPage() {
  const { data: cronjobs, refresh: refreshCronjobs } = useStore<Cronjob[]>('/cronjobs', () => api.get('/cronjobs'), { pollInterval: 10_000 })
  const { data: orchState, refresh: refreshOrch } = useStore<OrchestratorState>('/orchestrator', () => api.get('/orchestrator'), { pollInterval: 10_000 })
  const systemJobs = orchState?.jobs ?? []
  const pollIntervalMs = orchState?.config?.pollIntervalMs ?? 120000
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Cronjob | null>(null)
  const [pollerDialogOpen, setPollerDialogOpen] = useState(false)
  const [editingPoller, setEditingPoller] = useState<string | null>(null)
  const [pollerIntervalSec, setPollerIntervalSec] = useState('')

  const load = () => {
    refreshCronjobs()
    refreshOrch()
  }

  // Merge into one list: system pollers first, then custom cronjobs
  const rows: CronRow[] = [
    ...systemJobs.map((j): CronRow => ({
      id: `sys-${j.name}`,
      name: j.name,
      schedule: j.schedule,
      status: j.enabled === false ? 'paused' : j.status,
      lastRun: formatTime(j.lastRun),
      system: true,
      enabled: j.enabled ?? true,
    })),
    ...(cronjobs ?? []).map((c): CronRow => ({
      id: `cron-${c.id}`,
      name: c.name,
      schedule: c.schedule,
      status: c.status,
      lastRun: formatTime(c.last_run),
      system: false,
      cronjob: c,
    })),
  ]

  const handleSubmit = async (data: Partial<Cronjob>) => {
    if (editing) {
      await api.put(`/cronjobs/${editing.id}`, data)
    } else {
      await api.post('/cronjobs', data)
    }
    setEditing(null)
    load()
  }

  const handleToggle = async (c: Cronjob) => {
    await api.put(`/cronjobs/${c.id}`, { status: c.status === 'active' ? 'paused' : 'active' })
    load()
  }

  const handleSystemToggle = async (row: CronRow) => {
    const slug = slugify(row.name)
    await api.put(`/orchestrator/jobs/${slug}`, { enabled: !row.enabled })
    load()
  }

  const openPollerEdit = (row: CronRow) => {
    setEditingPoller(row.name)
    setPollerIntervalSec(String(pollIntervalMs / 1000))
    setPollerDialogOpen(true)
  }

  const handlePollerIntervalSave = async () => {
    const seconds = parseFloat(pollerIntervalSec)
    if (isNaN(seconds) || seconds <= 0) return
    const ms = Math.round(seconds * 1000)
    const slug = slugify(editingPoller || '')
    await api.put(`/orchestrator/jobs/${slug}`, { intervalMs: ms })
    setPollerDialogOpen(false)
    setEditingPoller(null)
    load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Crons</h1>
          <Badge variant="secondary" className="text-xs">{rows.length}</Badge>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true) }}>
          <Plus className="h-4 w-4" /> New Cron
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Run</TableHead>
            <TableHead className="w-24">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                No crons running.
              </TableCell>
            </TableRow>
          )}
          {rows.map(row => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">
                <span className="flex items-center gap-2">
                  {row.name}
                  {row.system && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-zinc-500 border-zinc-700">system</Badge>
                  )}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="font-mono text-xs">{row.schedule}</Badge>
              </TableCell>
              <TableCell>
                {row.system ? (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={row.enabled ?? true}
                      onCheckedChange={() => handleSystemToggle(row)}
                    />
                    <Badge className={statusColor(row.status)} variant="outline">{row.status}</Badge>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={row.cronjob?.status === 'active'}
                      onCheckedChange={() => row.cronjob && handleToggle(row.cronjob)}
                    />
                    <Badge className={statusColor(row.status)} variant="outline">{row.status}</Badge>
                  </div>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">{row.lastRun}</TableCell>
              <TableCell>
                {row.system ? (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openPollerEdit(row)}
                    >
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                  </div>
                ) : row.cronjob ? (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setEditing(row.cronjob!); setDialogOpen(true) }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400"
                      onClick={() => api.del(`/cronjobs/${row.cronjob!.id}`).then(load)}
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <CronjobForm
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cronjob={editing}
        onSubmit={handleSubmit}
      />

      <Dialog open={pollerDialogOpen} onOpenChange={setPollerDialogOpen}>
        <DialogContent onClose={() => setPollerDialogOpen(false)}>
          <DialogHeader>
            <DialogTitle>Edit {editingPoller}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Poll interval (seconds)</label>
              <Input
                type="number"
                min="10"
                step="1"
                value={pollerIntervalSec}
                onChange={e => setPollerIntervalSec(e.target.value)}
                placeholder="e.g. 120"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPollerDialogOpen(false)}>Cancel</Button>
            <Button onClick={handlePollerIntervalSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
