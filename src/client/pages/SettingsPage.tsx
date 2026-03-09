import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Settings, FileText, Save, Eye, EyeOff,
  Check, AlertCircle, Server, Download, Upload, RotateCcw, Trash2,
  Zap, Database, RefreshCw, Github, MessageSquare, Cpu, Bell,
  FolderOpen, Terminal, ScrollText, Palette, Flag,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SettingsSkeleton } from '@/components/skeletons/SettingsSkeleton'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

// --- Types ---

interface SettingEntry {
  key: string
  value: string
  type: string
  label: string
  description: string
  category: string
  updated_at: string
}

interface PromptTemplate {
  slug: string
  name: string
  description: string
  template: string
  max_attempts: number
  timeout_ms: number
  updated_at: string
}

interface SystemInfo {
  version: string
  nodeVersion: string
  uptime: number
  pid: number
  database: string
  redis: string
  memory: { rss: number; heapUsed: number; heapTotal: number }
  disk: {
    logs: { files: number; bytes: number }
    repos: { files: number; bytes: number }
  }
}

type SettingsMap = Record<string, SettingEntry[]>

// --- Sidebar nav definition ---

type SectionId =
  | 'general' | 'github' | 'discord' | 'worker' | 'notifications'
  | 'paths' | 'claude' | 'logging' | 'appearance' | 'features'
  | 'templates' | 'backup' | 'danger'

interface NavItem {
  id: SectionId
  label: string
  icon: React.ComponentType<{ className?: string }>
  separator?: 'before'
}

const NAV_ITEMS: NavItem[] = [
  { id: 'general', label: 'General', icon: Server },
  { id: 'github', label: 'GitHub', icon: Github },
  { id: 'discord', label: 'Discord', icon: MessageSquare },
  { id: 'worker', label: 'Worker', icon: Cpu },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'paths', label: 'Paths', icon: FolderOpen },
  { id: 'claude', label: 'Claude', icon: Terminal },
  { id: 'logging', label: 'Logging', icon: ScrollText },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'features', label: 'Features', icon: Flag },
  { id: 'templates', label: 'Templates', icon: FileText, separator: 'before' },
  { id: 'backup', label: 'Backup', icon: Database },
  { id: 'danger', label: 'Danger Zone', icon: AlertCircle, separator: 'before' },
]

// Map section IDs to settings category names (for config sections)
const SECTION_TO_CATEGORY: Partial<Record<SectionId, string>> = {
  github: 'github',
  discord: 'discord',
  worker: 'worker',
  notifications: 'notifications',
  paths: 'paths',
  claude: 'claude',
  logging: 'logging',
  appearance: 'appearance',
  features: 'features',
}

// --- Toast feedback component ---

function Toast({ message, type, onDismiss }: { message: string; type: 'success' | 'error'; onDismiss: () => void }) {
  return (
    <div
      className={`fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
        type === 'success'
          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
          : 'bg-red-500/20 text-red-400 border border-red-500/30'
      }`}
    >
      {type === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      {message}
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100">&times;</button>
    </div>
  )
}

// --- Helpers ---

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// --- useToast hook ---

function useToast() {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const show = (message: string, type: 'success' | 'error', duration = 3000) => {
    setToast({ message, type })
    setTimeout(() => setToast(null), duration)
  }

  return { toast, show, dismiss: () => setToast(null) }
}

// --- System Info Section ---

function SystemInfoSection({ info }: { info: SystemInfo }) {
  const [testing, setTesting] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  const testConnection = async (service: string) => {
    setTesting(service)
    try {
      const result = await api.post<{ ok: boolean; message: string }>('/settings/test-connection', { service })
      setTestResults(prev => ({ ...prev, [service]: result }))
    } catch (err) {
      setTestResults(prev => ({ ...prev, [service]: { ok: false, message: err instanceof Error ? err.message : 'Test failed' } }))
    } finally {
      setTesting(null)
    }
  }

  const StatusDot = ({ ok }: { ok: boolean | null }) => (
    <span className={`inline-block h-2 w-2 rounded-full ${ok === null ? 'bg-zinc-500' : ok ? 'bg-green-500' : 'bg-red-500'}`} />
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Server className="h-4 w-4 text-zinc-500" />
          System Info
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm md:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Version</div>
            <div className="font-mono">{info.version}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Node.js</div>
            <div className="font-mono">{info.nodeVersion}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Uptime</div>
            <div className="font-mono">{formatUptime(info.uptime)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">PID</div>
            <div className="font-mono">{info.pid}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Memory (heap)</div>
            <div className="font-mono">{formatBytes(info.memory.heapUsed)} / {formatBytes(info.memory.heapTotal)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Memory (RSS)</div>
            <div className="font-mono">{formatBytes(info.memory.rss)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Log Files</div>
            <div className="font-mono">{info.disk.logs.files} files ({formatBytes(info.disk.logs.bytes)})</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Repos</div>
            <div className="font-mono">{info.disk.repos.files} files ({formatBytes(info.disk.repos.bytes)})</div>
          </div>
        </div>

        <div className="mt-4 border-t border-zinc-800 pt-4">
          <div className="text-xs text-muted-foreground mb-2">Connections</div>
          <div className="flex flex-wrap gap-3">
            {(['database', 'redis', 'github', 'discord'] as const).map(service => {
              const autoStatus = service === 'database' ? info.database : service === 'redis' ? info.redis : null
              const testResult = testResults[service]
              const isOk = testResult ? testResult.ok : autoStatus ? autoStatus === 'connected' : null
              const label = service.charAt(0).toUpperCase() + service.slice(1)

              return (
                <button
                  key={service}
                  onClick={() => testConnection(service)}
                  disabled={testing === service}
                  className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs hover:bg-zinc-800/50 transition-colors disabled:opacity-50"
                >
                  <StatusDot ok={isOk} />
                  {label}
                  {testing === service ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <Zap className="h-3 w-3 text-zinc-500" />
                  )}
                </button>
              )
            })}
          </div>
          {Object.entries(testResults).map(([service, result]) => (
            <div key={service} className={`mt-1 text-xs ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
              {service}: {result.message}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// --- Category Configuration Section (single category) ---

function CategorySection({
  category,
  entries,
  values,
  setValues,
  visibleSecrets,
  toggleSecretVisibility,
  hasChanges,
  saving,
  onSave,
}: {
  category: string
  entries: SettingEntry[]
  values: Record<string, string>
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>
  visibleSecrets: Set<string>
  toggleSecretVisibility: (key: string) => void
  hasChanges: boolean
  saving: boolean
  onSave: () => void
}) {
  // Keys whose values are comma-separated lists — render as textarea
  const commaListKeys = new Set([
    'github.default_labels',
    'github.repos_whitelist',
    'discord.trigger_whitelist',
    'error_watcher.labels',
    'claude.flags',
  ])

  const renderInput = (entry: SettingEntry) => {
    const val = values[entry.key] ?? ''

    switch (entry.type) {
      case 'boolean':
        return (
          <Switch
            checked={val === 'true'}
            onCheckedChange={(checked) =>
              setValues((prev) => ({ ...prev, [entry.key]: String(checked) }))
            }
          />
        )
      case 'number':
        return (
          <Input
            type="number"
            value={val}
            onChange={(e) => setValues((prev) => ({ ...prev, [entry.key]: e.target.value }))}
            className="w-full"
          />
        )
      case 'secret':
        return (
          <div className="flex items-center gap-1">
            <Input
              type={visibleSecrets.has(entry.key) ? 'text' : 'password'}
              value={val}
              placeholder="Enter new value to change"
              onChange={(e) => setValues((prev) => ({ ...prev, [entry.key]: e.target.value }))}
              className="w-full"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleSecretVisibility(entry.key)}
              title={visibleSecrets.has(entry.key) ? 'Hide' : 'Show'}
            >
              {visibleSecrets.has(entry.key) ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          </div>
        )
      default:
        if (commaListKeys.has(entry.key)) {
          return (
            <Textarea
              value={val}
              onChange={(e) => setValues((prev) => ({ ...prev, [entry.key]: e.target.value }))}
              placeholder="One per line or comma-separated"
              rows={2}
              className="w-full font-mono text-xs"
            />
          )
        }
        return (
          <Input
            type="text"
            value={val}
            onChange={(e) => setValues((prev) => ({ ...prev, [entry.key]: e.target.value }))}
            className="w-full"
          />
        )
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold capitalize">{category}</h2>
        <p className="text-sm text-muted-foreground">
          {entries.length} setting{entries.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="space-y-5">
        {entries.map((entry) => (
          <div key={entry.key} className={entry.type === 'boolean'
            ? 'flex items-center justify-between gap-4'
            : 'space-y-1.5'
          }>
            <div className="min-w-0">
              <div className="text-sm font-medium">{entry.label}</div>
              <div className="text-xs text-muted-foreground">{entry.description}</div>
            </div>
            <div className={entry.type === 'boolean' ? 'shrink-0' : 'max-w-md'}>{renderInput(entry)}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onSave} disabled={saving || !hasChanges}>
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  )
}

// --- Prompt Template Editor Dialog ---

function TemplateEditor({
  template,
  open,
  onOpenChange,
  onSaved,
}: {
  template: PromptTemplate
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [templateText, setTemplateText] = useState(template.template)
  const [maxAttempts, setMaxAttempts] = useState(String(template.max_attempts))
  const [timeoutMs, setTimeoutMs] = useState(String(template.timeout_ms))
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Extract {{variables}} from template text
  const variables = useMemo(() => {
    const matches = templateText.match(/\{\{(\w+)\}\}/g)
    if (!matches) return []
    return [...new Set(matches.map((m) => m.slice(2, -2)))]
  }, [templateText])

  const handleSave = async () => {
    const maxAttemptsNum = parseInt(maxAttempts, 10)
    const timeoutMsNum = parseInt(timeoutMs, 10)
    if (Number.isNaN(maxAttemptsNum) || maxAttemptsNum < 1) {
      setToast({ message: 'Max attempts must be a positive number', type: 'error' })
      return
    }
    if (Number.isNaN(timeoutMsNum) || timeoutMsNum < 1000) {
      setToast({ message: 'Timeout must be at least 1000ms', type: 'error' })
      return
    }
    setSaving(true)
    setToast(null)
    try {
      await api.put(`/prompt-templates/${template.slug}`, {
        template: templateText,
        max_attempts: maxAttemptsNum,
        timeout_ms: timeoutMsNum,
      })
      setToast({ message: 'Template saved successfully', type: 'success' })
      onSaved()
      setTimeout(() => {
        setToast(null)
        onOpenChange(false)
      }, 1500)
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to save template', type: 'error' })
      setTimeout(() => setToast(null), 5000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl" onClose={() => onOpenChange(false)}>
          <DialogHeader>
            <DialogTitle>{template.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Template</label>
              <Textarea
                value={templateText}
                onChange={(e) => setTemplateText(e.target.value)}
                rows={12}
                className="font-mono text-xs"
              />
            </div>

            {variables.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Available variables</label>
                <div className="flex flex-wrap gap-1">
                  {variables.map((v) => (
                    <Badge key={v} variant="outline" className="font-mono text-[10px]">
                      {`{{${v}}}`}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Max attempts</label>
                <Input
                  type="number"
                  min="1"
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Timeout (ms)</label>
                <Input
                  type="number"
                  min="1000"
                  step="1000"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(e.target.value)}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </>
  )
}

// --- Prompt Templates Section ---

function PromptTemplatesSection({
  templates,
  onSaved,
}: {
  templates: PromptTemplate[]
  onSaved: () => void
}) {
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null)

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-zinc-500" />
            Prompt Templates
            <Badge variant="secondary" className="text-[10px]">
              {templates.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {templates.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No prompt templates configured.
            </p>
          )}
          {templates.map((t) => (
            <div
              key={t.slug}
              role="button"
              tabIndex={0}
              onClick={() => setEditingTemplate(t)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingTemplate(t) } }}
              className="flex items-center justify-between rounded-lg border border-zinc-800 p-4 hover:bg-zinc-800/50 cursor-pointer transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.description}</div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0 ml-4">
                {t.updated_at ? new Date(t.updated_at).toLocaleDateString() : '—'}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {editingTemplate && (
        <TemplateEditor
          key={editingTemplate.slug}
          template={editingTemplate}
          open={!!editingTemplate}
          onOpenChange={(open) => {
            if (!open) setEditingTemplate(null)
          }}
          onSaved={onSaved}
        />
      )}
    </>
  )
}

// --- Import/Export Section ---

function ImportExportSection({ onImported }: { onImported: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast, show, dismiss } = useToast()
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const data = await api.get<any>('/settings/export')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ultradev-settings-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      show('Settings exported', 'success')
    } catch (err) {
      show(err instanceof Error ? err.message : 'Export failed', 'error', 5000)
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const result = await api.post<{ ok: boolean; imported: { settings: number; promptTemplates: number } }>('/settings/import', data)
      show(`Imported ${result.imported.settings} settings, ${result.imported.promptTemplates} templates`, 'success')
      onImported()
    } catch (err) {
      show(err instanceof Error ? err.message : 'Import failed', 'error', 5000)
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Database className="h-4 w-4 text-zinc-500" />
            Import / Export
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Export your settings and prompt templates as JSON for backup, or import a previously exported configuration.
            Secrets are excluded from exports.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
              <Download className="h-4 w-4" />
              {exporting ? 'Exporting...' : 'Export'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              <Upload className="h-4 w-4" />
              {importing ? 'Importing...' : 'Import'}
            </Button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          </div>
        </CardContent>
      </Card>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={dismiss} />}
    </>
  )
}

// --- Danger Zone Section ---

function DangerZoneSection({ onReset }: { onReset: () => void }) {
  const [confirmReset, setConfirmReset] = useState(false)
  const [purgeDays, setPurgeDays] = useState('30')
  const { toast, show, dismiss } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const handleReset = async () => {
    setBusy('reset')
    try {
      await api.post('/settings/reset', {})
      show('All settings reset to defaults', 'success')
      setConfirmReset(false)
      onReset()
    } catch (err) {
      show(err instanceof Error ? err.message : 'Reset failed', 'error', 5000)
    } finally {
      setBusy(null)
    }
  }

  const handleClearCaches = async () => {
    setBusy('caches')
    try {
      await api.post('/settings/clear-caches', {})
      show('All caches cleared', 'success')
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to clear caches', 'error', 5000)
    } finally {
      setBusy(null)
    }
  }

  const handlePurgeLogs = async () => {
    const days = parseInt(purgeDays, 10)
    if (Number.isNaN(days) || days < 0) {
      show('Enter a valid number of days', 'error')
      return
    }
    setBusy('purge')
    try {
      const result = await api.post<{ ok: boolean; deleted: number }>('/settings/purge-logs', { olderThanDays: days })
      show(`Deleted ${result.deleted} log file(s)`, 'success')
    } catch (err) {
      show(err instanceof Error ? err.message : 'Purge failed', 'error', 5000)
    } finally {
      setBusy(null)
    }
  }

  const handleRestartService = async (service: string) => {
    setBusy(`restart-${service}`)
    try {
      const result = await api.post<{ ok: boolean; message: string }>('/settings/restart-service', { service })
      show(result.message, 'success')
    } catch (err) {
      show(err instanceof Error ? err.message : 'Restart failed', 'error', 5000)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Card className="border-red-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="h-4 w-4" />
            Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Restart Services */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Restart Services</div>
              <div className="text-xs text-muted-foreground">Refresh config and restart background services</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRestartService('all')}
              disabled={busy === 'restart-all'}
            >
              <RefreshCw className={`h-4 w-4 ${busy === 'restart-all' ? 'animate-spin' : ''}`} />
              {busy === 'restart-all' ? 'Restarting...' : 'Restart All'}
            </Button>
          </div>

          {/* Clear Caches */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Clear Caches</div>
              <div className="text-xs text-muted-foreground">Clear all server-side caches (Redis + in-memory)</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearCaches}
              disabled={busy === 'caches'}
            >
              <Trash2 className="h-4 w-4" />
              {busy === 'caches' ? 'Clearing...' : 'Clear'}
            </Button>
          </div>

          {/* Purge Logs */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Purge Old Logs</div>
              <div className="text-xs text-muted-foreground">Delete log files older than specified days</div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                value={purgeDays}
                onChange={(e) => setPurgeDays(e.target.value)}
                className="w-20"
              />
              <span className="text-xs text-muted-foreground">days</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePurgeLogs}
                disabled={busy === 'purge'}
              >
                <Trash2 className="h-4 w-4" />
                {busy === 'purge' ? 'Purging...' : 'Purge'}
              </Button>
            </div>
          </div>

          {/* Reset to Defaults */}
          <div className="flex items-center justify-between gap-4 border-t border-red-500/20 pt-4">
            <div>
              <div className="text-sm font-medium text-red-400">Reset All Settings</div>
              <div className="text-xs text-muted-foreground">Delete all settings and restore factory defaults. This cannot be undone.</div>
            </div>
            {!confirmReset ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmReset(true)}
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleReset}
                  disabled={busy === 'reset'}
                >
                  {busy === 'reset' ? 'Resetting...' : 'Confirm Reset'}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={dismiss} />}
    </>
  )
}

// --- Main Page ---

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>('general')

  const { data: settings, refresh: refreshSettings } = useStore<SettingsMap>(
    '/settings',
    () => api.get('/settings'),
  )
  const { data: templates, refresh: refreshTemplates } = useStore<PromptTemplate[]>(
    '/prompt-templates',
    () => api.get('/prompt-templates'),
  )
  const { data: systemInfo, refresh: refreshSystemInfo } = useStore<SystemInfo>(
    '/settings/system-info',
    () => api.get('/settings/system-info'),
    { ttl: 10_000 },
  )

  // --- Lifted settings form state ---
  const [values, setValues] = useState<Record<string, string>>({})
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [configToast, setConfigToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Sync form values when settings load or refresh
  useEffect(() => {
    if (!settings) return
    const initial: Record<string, string> = {}
    for (const entries of Object.values(settings)) {
      for (const entry of entries) {
        initial[entry.key] = entry.type === 'secret' ? '' : entry.value
      }
    }
    setValues(initial)
  }, [settings])

  const toggleSecretVisibility = (key: string) => {
    setVisibleSecrets((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const hasChanges = useMemo(() => {
    if (!settings) return false
    for (const entries of Object.values(settings)) {
      for (const entry of entries) {
        if (entry.type === 'secret' && values[entry.key] === '') continue
        if (values[entry.key] !== entry.value) return true
      }
    }
    return false
  }, [settings, values])

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    setConfigToast(null)
    try {
      const payload: Record<string, string> = {}
      for (const entries of Object.values(settings)) {
        for (const entry of entries) {
          if (entry.type === 'secret' && values[entry.key] === '') continue
          if (values[entry.key] !== entry.value) {
            payload[entry.key] = values[entry.key]
          }
        }
      }
      await api.put('/settings', payload)
      // Reset saved secrets to empty so hasChanges recalculates correctly
      const savedSecretKeys = Object.values(settings).flat().filter(e => e.type === 'secret' && payload[e.key] !== undefined).map(e => e.key)
      if (savedSecretKeys.length > 0) {
        setValues((prev) => {
          const next = { ...prev }
          for (const key of savedSecretKeys) next[key] = ''
          return next
        })
      }
      setConfigToast({ message: 'Settings saved successfully', type: 'success' })
      refreshSettings()
      setTimeout(() => setConfigToast(null), 3000)
    } catch (err) {
      setConfigToast({ message: err instanceof Error ? err.message : 'Failed to save settings', type: 'error' })
      setTimeout(() => setConfigToast(null), 5000)
    } finally {
      setSaving(false)
    }
  }

  if (settings === null || templates === null) return <SettingsSkeleton />

  const refreshAll = () => {
    refreshSettings()
    refreshTemplates()
    refreshSystemInfo()
  }

  const renderContent = () => {
    const category = SECTION_TO_CATEGORY[activeSection]

    // Config category sections
    if (category && settings[category]) {
      return (
        <CategorySection
          category={category}
          entries={settings[category]}
          values={values}
          setValues={setValues}
          visibleSecrets={visibleSecrets}
          toggleSecretVisibility={toggleSecretVisibility}
          hasChanges={hasChanges}
          saving={saving}
          onSave={handleSave}
        />
      )
    }

    // If the category key doesn't exist in settings yet, show empty state for config sections
    if (category) {
      return (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold capitalize">{category}</h2>
            <p className="text-sm text-muted-foreground">No settings available for this category.</p>
          </div>
        </div>
      )
    }

    switch (activeSection) {
      case 'general':
        return systemInfo ? <SystemInfoSection info={systemInfo} /> : (
          <div className="text-sm text-muted-foreground">Loading system info...</div>
        )
      case 'templates':
        return <PromptTemplatesSection templates={templates} onSaved={refreshTemplates} />
      case 'backup':
        return <ImportExportSection onImported={refreshAll} />
      case 'danger':
        return <DangerZoneSection onReset={refreshAll} />
      default:
        return null
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center gap-2">
        <Settings className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <div className="mt-6 flex gap-6">
        {/* Sidebar */}
        <aside className="w-52 shrink-0">
          <nav className="sticky top-4 space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.id}>
                  {item.separator === 'before' && (
                    <div className="my-2 border-t border-zinc-800" />
                  )}
                  <button
                    onClick={() => setActiveSection(item.id)}
                    className={cn(
                      'flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      activeSection === item.id
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                </div>
              )
            })}
          </nav>
        </aside>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          {renderContent()}
        </div>
      </div>

      {configToast && <Toast message={configToast.message} type={configToast.type} onDismiss={() => setConfigToast(null)} />}
    </div>
  )
}
