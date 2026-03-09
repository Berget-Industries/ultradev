import { useState, useMemo } from 'react'
import { Settings, FileText, Save, Eye, EyeOff, ChevronDown, ChevronRight, Check, AlertCircle } from 'lucide-react'
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

type SettingsMap = Record<string, SettingEntry[]>

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

// --- Configuration Section ---

function ConfigurationSection({
  settings,
  onSaved,
}: {
  settings: SettingsMap
  onSaved: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const entries of Object.values(settings)) {
      for (const entry of entries) {
        initial[entry.key] = entry.value
      }
    }
    return initial
  })
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set())
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const categories = Object.keys(settings)

  const hasChanges = useMemo(() => {
    for (const entries of Object.values(settings)) {
      for (const entry of entries) {
        if (values[entry.key] !== entry.value) return true
      }
    }
    return false
  }, [settings, values])

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const toggleSecretVisibility = (key: string) => {
    setVisibleSecrets((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setToast(null)
    try {
      // Build payload: only changed values
      const payload: Record<string, string> = {}
      for (const entries of Object.values(settings)) {
        for (const entry of entries) {
          if (values[entry.key] !== entry.value) {
            payload[entry.key] = values[entry.key]
          }
        }
      }
      await api.put('/settings', payload)
      setToast({ message: 'Settings saved successfully', type: 'success' })
      onSaved()
      setTimeout(() => setToast(null), 3000)
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to save settings', type: 'error' })
      setTimeout(() => setToast(null), 5000)
    } finally {
      setSaving(false)
    }
  }

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
            className="w-48"
          />
        )
      case 'secret':
        return (
          <div className="flex items-center gap-1">
            <Input
              type={visibleSecrets.has(entry.key) ? 'text' : 'password'}
              value={val}
              onChange={(e) => setValues((prev) => ({ ...prev, [entry.key]: e.target.value }))}
              className="w-48"
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
        return (
          <Input
            type="text"
            value={val}
            onChange={(e) => setValues((prev) => ({ ...prev, [entry.key]: e.target.value }))}
            className="w-48"
          />
        )
    }
  }

  return (
    <>
      <div className="space-y-4">
        {categories.map((category) => {
          const entries = settings[category]
          const isCollapsed = collapsedCategories.has(category)
          return (
            <Card key={category}>
              <CardHeader
                className="cursor-pointer select-none"
                onClick={() => toggleCategory(category)}
              >
                <CardTitle className="flex items-center gap-2 text-sm">
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-zinc-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-zinc-500" />
                  )}
                  {category}
                  <Badge variant="secondary" className="text-[10px]">
                    {entries.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              {!isCollapsed && (
                <CardContent className="space-y-4">
                  {entries.map((entry) => (
                    <div key={entry.key} className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{entry.label}</div>
                        <div className="text-xs text-muted-foreground">{entry.description}</div>
                      </div>
                      <div className="shrink-0">{renderInput(entry)}</div>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          )
        })}

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving || !hasChanges}>
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </>
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
              onClick={() => setEditingTemplate(t)}
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

// --- Main Page ---

export default function SettingsPage() {
  const { data: settings, refresh: refreshSettings } = useStore<SettingsMap>(
    '/settings',
    () => api.get('/settings'),
  )
  const { data: templates, refresh: refreshTemplates } = useStore<PromptTemplate[]>(
    '/prompt-templates',
    () => api.get('/prompt-templates'),
  )

  if (settings === null || templates === null) return <SettingsSkeleton />

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {settings && (
        <ConfigurationSection settings={settings} onSaved={refreshSettings} />
      )}

      {templates && (
        <PromptTemplatesSection templates={templates} onSaved={refreshTemplates} />
      )}
    </div>
  )
}
