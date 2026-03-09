import { Skeleton } from '@/components/ui/skeleton'

export function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-6 rounded" />
        <Skeleton className="h-7 w-24" />
      </div>

      {/* Configuration section */}
      <div className="rounded-xl border bg-card shadow p-6 space-y-4">
        <Skeleton className="h-5 w-32" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="space-y-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-9 w-48 rounded-md" />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-card shadow p-6 space-y-4">
        <Skeleton className="h-5 w-28" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="space-y-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-9 w-48 rounded-md" />
            </div>
          ))}
        </div>
      </div>

      {/* Prompt templates section */}
      <div className="rounded-xl border bg-card shadow p-6 space-y-4">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-zinc-800 p-4">
            <div className="space-y-1">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-3.5 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}
