import { spawn } from 'child_process'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { loadConfig } from './config.js'
import { notify } from './notifier.js'

interface ErrorEntry {
  count: number
  lastSeen: number
  healing: boolean
}

const errorHistory = new Map<string, ErrorEntry>()
const MAX_SAME_ERROR = 3
const COOLDOWN_MS = 5 * 60 * 1000

export async function tryHeal(component: string, error: string, context: { file?: string; extra?: string } = {}): Promise<boolean> {
  const errorKey = `${component}:${normalizeError(error)}`

  const history = errorHistory.get(errorKey) || { count: 0, lastSeen: 0, healing: false }

  if (history.healing) {
    console.log(`[self-heal] Already healing ${errorKey}, skipping`)
    return false
  }

  if (history.count >= MAX_SAME_ERROR) {
    console.log(`[self-heal] Gave up on ${errorKey} after ${history.count} attempts`)
    return false
  }

  if (Date.now() - history.lastSeen < COOLDOWN_MS) {
    console.log(`[self-heal] Cooldown active for ${errorKey}`)
    return false
  }

  history.count++
  history.lastSeen = Date.now()
  history.healing = true
  errorHistory.set(errorKey, history)

  console.log(`[self-heal] Attempting fix for ${component}: ${error} (attempt ${history.count}/${MAX_SAME_ERROR})`)
  notify(`🔧 Self-healing: ${component} error — "${truncate(error, 100)}" (attempt ${history.count})`)

  try {
    const fixed = await attemptFix(component, error, context)
    history.healing = false

    if (fixed) {
      notify(`✅ Self-healed: ${component}`)
      history.count = 0
      return true
    } else {
      notify(`⚠️ Could not self-heal: ${component} — "${truncate(error, 100)}"`)
      return false
    }
  } catch (healError: any) {
    history.healing = false
    console.error(`[self-heal] Heal attempt itself failed:`, healError.message)
    return false
  }
}

async function attemptFix(component: string, error: string, context: { file?: string; extra?: string }): Promise<boolean> {
  const config = loadConfig()

  const quickFix = tryQuickFix(component, error)
  if (quickFix !== undefined) return quickFix

  if (context.file) {
    const logFile = join(config.paths.logs, `heal_${Date.now()}.log`)
    mkdirSync(config.paths.logs, { recursive: true })

    const prompt = `You are fixing an error in the UltraDev system (~/ultradev/).

## Component: ${component}
## Error: ${error}
${context.file ? `## File: ${context.file}` : ''}
${context.extra ? `## Context: ${context.extra}` : ''}

## Instructions
1. Read the file(s) involved.
2. Understand the error.
3. Fix it with minimal changes.
4. Do NOT restructure or refactor — just fix the specific error.

If you cannot fix it, explain why in a comment but do not make random changes.`

    return new Promise((resolve) => {
      const child = spawn(config.claude.command, [
        ...config.claude.flags,
        '--print',
        prompt,
      ], {
        cwd: join(process.env.HOME!, 'ultradev'),
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 3 * 60 * 1000,
      })

      let output = ''
      child.stdout.on('data', (d: Buffer) => {
        output += d.toString()
        appendFileSync(logFile, d)
      })
      child.stderr.on('data', (d: Buffer) => appendFileSync(logFile, d))

      child.on('close', (code: number | null) => {
        console.log(`[self-heal] Claude fix exited with code ${code}`)
        resolve(code === 0)
      })

      child.on('error', () => resolve(false))
    })
  }

  return false
}

function tryQuickFix(_component: string, error: string): boolean | undefined {
  if (error.includes('ENOENT')) {
    console.log(`[self-heal] ENOENT is a config issue, not auto-fixable by code`)
    return false
  }

  if (error.includes('rate limit') || error.includes('429')) {
    console.log(`[self-heal] Rate limited — just need to wait`)
    return false
  }

  if (error.includes('401') || error.includes('403') || error.includes('authentication')) {
    console.log(`[self-heal] Auth error — needs manual intervention`)
    return false
  }

  return undefined
}

function normalizeError(error: string): string {
  return error
    .replace(/\d{10,}/g, 'TIMESTAMP')
    .replace(/pid \d+/g, 'pid PID')
    .replace(/port \d+/g, 'port PORT')
    .substring(0, 200)
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.substring(0, len) + '...' : str
}
