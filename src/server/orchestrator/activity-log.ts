const MAX_ENTRIES = 200

export interface ActivityEntry {
  ts: number
  source: string  // e.g. 'pr-poller', 'poller', 'worker', 'system'
  message: string
}

const entries: ActivityEntry[] = []

export function logActivity(source: string, message: string) {
  entries.push({ ts: Date.now(), source, message })
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
}

export function getActivityLog(limit = 50): ActivityEntry[] {
  return entries.slice(-limit).reverse()
}
