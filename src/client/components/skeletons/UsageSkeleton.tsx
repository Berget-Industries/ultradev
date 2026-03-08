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

function StatCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-2.5 w-12" />
      </div>
      <Skeleton className="h-7 w-20" />
      <Skeleton className="h-3 w-28 mt-2" />
    </Card>
  )
}

function DailyBarChartSkeleton() {
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Skeleton className="h-3 w-3 rounded" />
          <Skeleton className="h-2.5 w-28" />
        </div>
        <div className="flex items-end gap-1 h-24">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex flex-col items-center justify-end h-20">
                <Skeleton className="w-full rounded-t" style={{ height: `${5 + Math.random() * 75}%` }} />
              </div>
              <Skeleton className="h-2 w-6" />
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Skeleton className="h-3 w-3 rounded" />
          <Skeleton className="h-2.5 w-28" />
        </div>
        <div className="flex items-end gap-1 h-24">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex flex-col items-center justify-end h-20">
                <Skeleton className="w-full rounded-t" style={{ height: `${5 + Math.random() * 75}%` }} />
              </div>
              <Skeleton className="h-2 w-6" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-1">
          <div className="flex items-center gap-1">
            <Skeleton className="h-2 w-2 rounded-sm" />
            <Skeleton className="h-2 w-8" />
          </div>
          <div className="flex items-center gap-1">
            <Skeleton className="h-2 w-2 rounded-sm" />
            <Skeleton className="h-2 w-8" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function UsageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Today */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-3 w-20 ml-1" />
        </div>
        <div className="grid grid-cols-4 gap-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      </div>

      {/* All Time */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="grid grid-cols-4 gap-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      </div>

      {/* Daily Chart */}
      <Card className="p-4">
        <DailyBarChartSkeleton />
      </Card>

      {/* Per-Task Breakdown */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-14 ml-1" />
        </div>
        <Card className="p-0 overflow-hidden">
          <div className="max-h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Task</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Input</TableHead>
                  <TableHead className="text-xs text-right">Output</TableHead>
                  <TableHead className="text-xs text-right">Total</TableHead>
                  <TableHead className="text-xs text-right">Cost</TableHead>
                  <TableHead className="text-xs text-right">Duration</TableHead>
                  <TableHead className="text-xs text-right">Tools</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-3.5 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-14 rounded-full" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-3.5 w-16 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-3.5 w-14 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-3.5 w-16 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-3.5 w-12 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-3.5 w-12 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-3.5 w-8 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-20" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  )
}
