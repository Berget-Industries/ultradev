import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { notify } from './notifier.js'

import { DATA_DIR } from '../paths.js'

const STATE_FILE = join(DATA_DIR, 'rate-limit.json')

let rateLimited = false
let resetsAt: number | null = null
let resumeTimer: ReturnType<typeof setTimeout> | null = null
let onResume: (() => void) | null = null

// Load persisted state on import
loadState()

function loadState() {
  try {
    if (!existsSync(STATE_FILE)) return
    const data = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
    if (data.resetsAt && Date.now() < data.resetsAt * 1000) {
      rateLimited = true
      resetsAt = data.resetsAt
      console.log(`[rate-limit] Restored rate limit from disk. Resets at ${new Date(resetsAt! * 1000).toLocaleTimeString()}`)
    } else {
      // Expired, clean up
      saveState(false, null)
    }
  } catch { /* ok */ }
}

function saveState(limited: boolean, resets: number | null) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ rateLimited: limited, resetsAt: resets }))
  } catch { /* ok */ }
}

export function getRateLimitState() {
  return {
    rateLimited,
    resetsAt,
    resetsIn: resetsAt ? Math.max(0, resetsAt * 1000 - Date.now()) : null,
  }
}

export function isRateLimited(): boolean {
  // Auto-clear if past reset time
  if (rateLimited && resetsAt && Date.now() >= resetsAt * 1000) {
    clearRateLimit()
  }
  return rateLimited
}

export function setOnResume(fn: () => void) {
  onResume = fn
  // If already rate limited from persisted state, schedule resume
  if (rateLimited && resetsAt) {
    scheduleResume()
  }
}

export function handleRateLimitEvent(info: { status: string; resetsAt?: number; overageStatus?: string; rateLimitType?: string }) {
  // Only trigger on actual rate limit rejection — NOT on overageStatus (that's just billing info)
  if (info.status === 'rejected' || info.status === 'rate_limited') {
    if (rateLimited) return // already handled

    rateLimited = true
    resetsAt = info.resetsAt || null
    saveState(rateLimited, resetsAt)

    const resetDate = resetsAt ? new Date(resetsAt * 1000) : null
    const resetStr = resetDate ? resetDate.toLocaleTimeString() : 'unknown'
    const waitMin = resetsAt ? Math.ceil((resetsAt * 1000 - Date.now()) / 60000) : '?'

    console.log(`[rate-limit] Hit rate limit (${info.rateLimitType}). Resets at ${resetStr} (~${waitMin}min)`)
    notify(`⏸️ **Rate limited** (${info.rateLimitType}). Auto-resuming at ${resetStr} (~${waitMin}min).`)

    scheduleResume()
  }
}

function scheduleResume() {
  if (!resetsAt) return
  const delayMs = Math.max(0, resetsAt * 1000 - Date.now()) + 5000 // 5s buffer
  if (resumeTimer) clearTimeout(resumeTimer)
  resumeTimer = setTimeout(() => {
    clearRateLimit()
    console.log('[rate-limit] Rate limit cleared, resuming pollers')
    notify('🟢 Rate limit cleared. Resuming operations.')
    onResume?.()
  }, delayMs)
}

function clearRateLimit() {
  rateLimited = false
  resetsAt = null
  saveState(false, null)
  if (resumeTimer) {
    clearTimeout(resumeTimer)
    resumeTimer = null
  }
}
