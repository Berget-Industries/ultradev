export const HOME = process.env.HOME || '/home/' + (process.env.USER || 'user')

export interface TriggerRule {
  channelId: string
  authorId: string
}

export function splitCsv(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

export function parseTriggerWhitelist(raw: string): TriggerRule[] {
  if (!raw.trim()) return []
  return raw.split(',').map(entry => {
    const [channelId, authorId] = entry.trim().split(':')
    return { channelId, authorId }
  }).filter(r => r.channelId && r.authorId)
}

export function safeParseInt(val: string, fallback: number): number {
  const parsed = parseInt(val, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

/** Expand leading ~ to $HOME */
export function expandTilde(path: string): string {
  return path.replace(/^~/, HOME)
}
