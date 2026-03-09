import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { MultiSelect } from '@/components/ui/multi-select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

export interface Project {
  id: number
  name: string
  repo_url: string
  description: string
  status: 'active' | 'paused' | 'archived'
  cronjob_ids: number[]
  worker_timeout_ms: number | null
  default_labels: string | null
  max_attempts: number | null
  notify_on_success: boolean | null
  notify_on_failure: boolean | null
  created_at: string
  updated_at: string
}

export interface CronjobOption {
  id: number
  name: string
  schedule: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: Project | null
  cronjobs: CronjobOption[]
  onSubmit: (data: Partial<Project>) => void
}

export function ProjectForm({ open, onOpenChange, project, cronjobs, onSubmit }: Props) {
  const [name, setName] = useState('')
  const [repo_url, setRepoUrl] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<string>('active')
  const [selectedCrons, setSelectedCrons] = useState<number[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Per-project overrides (empty string / null = inherit global)
  const [workerTimeoutMs, setWorkerTimeoutMs] = useState<string>('')
  const [defaultLabels, setDefaultLabels] = useState<string>('')
  const [maxAttempts, setMaxAttempts] = useState<string>('')
  const [notifyOnSuccess, setNotifyOnSuccess] = useState<boolean | null>(null)
  const [notifyOnFailure, setNotifyOnFailure] = useState<boolean | null>(null)

  useEffect(() => {
    if (project) {
      setName(project.name)
      setRepoUrl(project.repo_url)
      setDescription(project.description)
      setStatus(project.status)
      setSelectedCrons(project.cronjob_ids || [])
      setWorkerTimeoutMs(project.worker_timeout_ms != null ? String(project.worker_timeout_ms / 1000) : '')
      setDefaultLabels(project.default_labels ?? '')
      setMaxAttempts(project.max_attempts != null ? String(project.max_attempts) : '')
      setNotifyOnSuccess(project.notify_on_success)
      setNotifyOnFailure(project.notify_on_failure)
      // Auto-expand advanced if any override is set
      setShowAdvanced(
        project.worker_timeout_ms != null ||
        !!project.default_labels ||
        project.max_attempts != null ||
        project.notify_on_success != null ||
        project.notify_on_failure != null
      )
    } else {
      setName('')
      setRepoUrl('')
      setDescription('')
      setStatus('active')
      setSelectedCrons([])
      setWorkerTimeoutMs('')
      setDefaultLabels('')
      setMaxAttempts('')
      setNotifyOnSuccess(null)
      setNotifyOnFailure(null)
      setShowAdvanced(false)
    }
  }, [project, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      name,
      repo_url,
      description,
      status: status as Project['status'],
      cronjob_ids: selectedCrons,
      worker_timeout_ms: workerTimeoutMs ? Number(workerTimeoutMs) * 1000 : null,
      default_labels: defaultLabels || null,
      max_attempts: maxAttempts ? Number(maxAttempts) : null,
      notify_on_success: notifyOnSuccess,
      notify_on_failure: notifyOnFailure,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{project ? 'Edit Project' : 'New Project'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div>
            <label className="text-sm font-medium">Repo URL</label>
            <Input value={repo_url} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/..." />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>
          <div>
            <label className="text-sm font-medium">Status</label>
            <Select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
          {cronjobs.length > 0 && (
            <div>
              <label className="text-sm font-medium block mb-1">Cronjobs</label>
              <MultiSelect
                options={cronjobs.map(c => ({ value: c.id, label: c.name, detail: c.schedule }))}
                selected={selectedCrons}
                onChange={setSelectedCrons}
                placeholder="Select cronjobs..."
              />
            </div>
          )}

          {/* Advanced: per-project overrides */}
          <div className="border-t border-zinc-800 pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-zinc-300 transition-colors"
            >
              {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Overrides
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Leave empty to use global defaults.
                </p>
                <div>
                  <label className="text-sm font-medium">Worker Timeout</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="10"
                      value={workerTimeoutMs}
                      onChange={e => setWorkerTimeoutMs(e.target.value)}
                      placeholder="1800"
                    />
                    <span className="text-xs text-muted-foreground shrink-0">seconds</span>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Default Labels</label>
                  <Input
                    value={defaultLabels}
                    onChange={e => setDefaultLabels(e.target.value)}
                    placeholder="bug, enhancement"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Max Attempts</label>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    value={maxAttempts}
                    onChange={e => setMaxAttempts(e.target.value)}
                    placeholder="3"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Notify on Success</div>
                    <div className="text-xs text-muted-foreground">
                      {notifyOnSuccess === null ? 'Using global default' : 'Overridden'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {notifyOnSuccess !== null && (
                      <button
                        type="button"
                        onClick={() => setNotifyOnSuccess(null)}
                        className="text-[10px] text-muted-foreground hover:text-zinc-300"
                      >
                        reset
                      </button>
                    )}
                    <Switch
                      checked={notifyOnSuccess ?? true}
                      onCheckedChange={(v) => setNotifyOnSuccess(v)}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Notify on Failure</div>
                    <div className="text-xs text-muted-foreground">
                      {notifyOnFailure === null ? 'Using global default' : 'Overridden'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {notifyOnFailure !== null && (
                      <button
                        type="button"
                        onClick={() => setNotifyOnFailure(null)}
                        className="text-[10px] text-muted-foreground hover:text-zinc-300"
                      >
                        reset
                      </button>
                    )}
                    <Switch
                      checked={notifyOnFailure ?? true}
                      onCheckedChange={(v) => setNotifyOnFailure(v)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{project ? 'Save' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
