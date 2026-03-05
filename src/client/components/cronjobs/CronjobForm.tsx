import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

export interface Cronjob {
  id: number
  name: string
  schedule: string
  description: string
  command: string
  status: 'active' | 'paused'
  last_run: string | null
  next_run: string | null
  created_at: string
  updated_at: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  cronjob?: Cronjob | null
  onSubmit: (data: Partial<Cronjob>) => void
}

export function CronjobForm({ open, onOpenChange, cronjob, onSubmit }: Props) {
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('* * * * *')
  const [description, setDescription] = useState('')
  const [command, setCommand] = useState('')

  useEffect(() => {
    if (cronjob) {
      setName(cronjob.name)
      setSchedule(cronjob.schedule)
      setDescription(cronjob.description)
      setCommand(cronjob.command)
    } else {
      setName('')
      setSchedule('* * * * *')
      setDescription('')
      setCommand('')
    }
  }, [cronjob, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({ name, schedule, description, command })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{cronjob ? 'Edit Cronjob' : 'New Cronjob'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div>
            <label className="text-sm font-medium">Schedule (cron expression)</label>
            <Input value={schedule} onChange={e => setSchedule(e.target.value)} placeholder="*/5 * * * *" />
          </div>
          <div>
            <label className="text-sm font-medium">Command</label>
            <Input value={command} onChange={e => setCommand(e.target.value)} placeholder="echo hello" />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">{cronjob ? 'Save' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
