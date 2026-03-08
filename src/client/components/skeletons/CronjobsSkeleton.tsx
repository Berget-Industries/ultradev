import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export function CronjobsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-5 w-6 rounded-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
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
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-28" />
                  {i < 3 && <Skeleton className="h-4 w-14 rounded-full" />}
                </div>
              </TableCell>
              <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-8 rounded-full" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
              </TableCell>
              <TableCell><Skeleton className="h-3.5 w-20" /></TableCell>
              <TableCell><Skeleton className="h-7 w-14 rounded-md" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
