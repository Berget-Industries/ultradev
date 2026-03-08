import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

function StatRingSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div>
        <Skeleton className="h-2.5 w-8 mb-1" />
        <Skeleton className="h-2.5 w-14" />
      </div>
    </div>
  )
}

function PerfStatSkeleton() {
  return (
    <Card className="p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-3 w-12" />
      </div>
      <Skeleton className="h-7 w-16 mt-1" />
      <Skeleton className="h-3 w-20 mt-1" />
      <div className="flex gap-3 mt-1 pt-1 border-t border-zinc-800">
        <div className="flex flex-col gap-0.5">
          <Skeleton className="h-3 w-8" />
          <Skeleton className="h-2.5 w-6" />
        </div>
        <div className="flex flex-col gap-0.5">
          <Skeleton className="h-3 w-8" />
          <Skeleton className="h-2.5 w-6" />
        </div>
      </div>
    </Card>
  )
}

function IssueTableSkeleton() {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="h-[200px]">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-zinc-950">
            <TableRow>
              <TableHead className="text-xs">Issue</TableHead>
              <TableHead className="text-xs">Labels</TableHead>
              <TableHead className="text-xs">PR</TableHead>
              <TableHead className="text-xs">CI</TableHead>
              <TableHead className="text-xs">Review</TableHead>
              <TableHead className="text-xs">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 4 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-3.5 w-40" /></TableCell>
                <TableCell><Skeleton className="h-4 w-14 rounded-full" /></TableCell>
                <TableCell><Skeleton className="h-3.5 w-10" /></TableCell>
                <TableCell><Skeleton className="h-3.5 w-6 rounded-full" /></TableCell>
                <TableCell><Skeleton className="h-3.5 w-6 rounded-full" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16 rounded-full" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}

function ActivityLogSkeleton() {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="max-h-[200px] divide-y divide-zinc-800/50">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-3 py-1.5 flex items-start gap-2">
            <Skeleton className="h-3.5 w-14 shrink-0" />
            <Skeleton className="h-4 w-12 rounded-full shrink-0" />
            <Skeleton className="h-3.5 w-full max-w-[300px]" />
          </div>
        ))}
      </div>
    </Card>
  )
}

function ActiveWorkSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-1.5 w-1.5 rounded-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-12 rounded-full" />
              <Skeleton className="h-4 w-16 rounded-full" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="grid grid-cols-4 gap-3 mb-3">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
          <Skeleton className="h-3 w-full mb-2" />
          <Skeleton className="h-3 w-3/4" />
        </Card>
      ))}
    </div>
  )
}

function HistoryTableSkeleton() {
  return (
    <Card className="p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Key</TableHead>
            <TableHead className="text-xs">Type</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">Attempts</TableHead>
            <TableHead className="text-xs">Tools</TableHead>
            <TableHead className="text-xs">Tokens</TableHead>
            <TableHead className="text-xs">Cost</TableHead>
            <TableHead className="text-xs">PR</TableHead>
            <TableHead className="text-xs">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 6 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-3.5 w-32" /></TableCell>
              <TableCell><Skeleton className="h-4 w-10 rounded-full" /></TableCell>
              <TableCell><Skeleton className="h-4 w-12 rounded-full" /></TableCell>
              <TableCell><Skeleton className="h-3.5 w-4" /></TableCell>
              <TableCell><Skeleton className="h-3.5 w-6" /></TableCell>
              <TableCell><Skeleton className="h-3.5 w-14" /></TableCell>
              <TableCell><Skeleton className="h-3.5 w-12" /></TableCell>
              <TableCell><Skeleton className="h-3.5 w-8" /></TableCell>
              <TableCell><Skeleton className="h-3.5 w-12" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      {/* System Health Strip */}
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3.5 w-3.5 rounded" />
          <Skeleton className="h-2.5 w-12" />
        </div>
        <StatRingSkeleton />
        <StatRingSkeleton />
        <div>
          <Skeleton className="h-2.5 w-8 mb-1" />
          <Skeleton className="h-5 w-10" />
        </div>

        <div className="h-6 w-px bg-zinc-800" />

        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3.5 w-3.5 rounded" />
          <Skeleton className="h-2.5 w-12" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Skeleton className="h-1.5 w-1.5 rounded-full" />
            <Skeleton className="h-3 w-3 rounded" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-4 w-7 rounded-full" />
          </div>
        ))}
      </div>

      {/* Performance Stats */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="grid grid-cols-5 lg:grid-cols-9 gap-2">
          <PerfStatSkeleton />
          <PerfStatSkeleton />
          <PerfStatSkeleton />
          <PerfStatSkeleton />
          <PerfStatSkeleton />
          <PerfStatSkeleton />
          <PerfStatSkeleton />
          <Card className="p-3 col-span-2 flex flex-col justify-between">
            <Skeleton className="h-3 w-20 mb-1" />
            <div className="flex items-end gap-[3px] h-10 flex-1">
              {Array.from({ length: 14 }).map((_, i) => (
                <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${8 + Math.random() * 32}px` }} />
              ))}
            </div>
            <div className="flex justify-between mt-1">
              <Skeleton className="h-2.5 w-10" />
              <Skeleton className="h-2.5 w-10" />
            </div>
          </Card>
        </div>
      </div>

      {/* Open Issues + Activity Log */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-6 rounded-full ml-1" />
          </div>
          <IssueTableSkeleton />
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-6 ml-1" />
          </div>
          <ActivityLogSkeleton />
        </div>
      </div>

      {/* Active Work */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-24" />
        </div>
        <ActiveWorkSkeleton />
      </div>

      {/* History */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-6 ml-1" />
        </div>
        <HistoryTableSkeleton />
      </div>
    </div>
  )
}
