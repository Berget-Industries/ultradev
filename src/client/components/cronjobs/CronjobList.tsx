import { Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import type { Cronjob } from './CronjobForm'

interface Props {
  cronjobs: Cronjob[]
  onEdit: (c: Cronjob) => void
  onDelete: (id: number) => void
  onToggle: (c: Cronjob) => void
}

export function CronjobList({ cronjobs, onEdit, onDelete, onToggle }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Schedule</TableHead>
          <TableHead>Command</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last Run</TableHead>
          <TableHead>Next Run</TableHead>
          <TableHead className="w-24">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cronjobs.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
              No cronjobs yet. Create one to get started.
            </TableCell>
          </TableRow>
        )}
        {cronjobs.map(c => (
          <TableRow key={c.id}>
            <TableCell className="font-medium">{c.name}</TableCell>
            <TableCell>
              <Badge variant="outline" className="font-mono text-xs">{c.schedule}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground max-w-xs truncate">{c.command || '-'}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Switch checked={c.status === 'active'} onCheckedChange={() => onToggle(c)} />
                <span className="text-xs text-muted-foreground">{c.status}</span>
              </div>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{c.last_run || '-'}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{c.next_run || '-'}</TableCell>
            <TableCell>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => onEdit(c)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => onDelete(c.id)}><Trash2 className="h-4 w-4 text-destructive-foreground" /></Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
