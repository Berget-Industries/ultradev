import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const dataDir = process.env.ULTRADEV_DATA_DIR || join(process.env.HOME!, '.ultradev')
const STATE_PATH = join(dataDir, 'state.json')

export interface IssueState {
  status: string
  attempts?: number
  repo?: string
  number?: number
  type?: string
  prUrl?: string | null
  error?: string
  madeProgress?: boolean
  notifiedMaxRetries?: boolean
  ciStatus?: string
  ciFailedChecks?: string
  selfReviewed?: boolean
  logFile?: string
  updatedAt?: number
  lastReviewAt?: string  // ISO timestamp of the latest review we addressed
}

interface State {
  issues: Record<string, IssueState>
}

// In-memory cache for fast API reads
let memoryState: State = { issues: {} }

function load(): State {
  if (!existsSync(STATE_PATH)) return { issues: {} }
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
  } catch {
    return { issues: {} }
  }
}

function save(state: State) {
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
  memoryState = state
}

// Initialize from disk
memoryState = load()

export function getIssueState(key: string): IssueState | null {
  const state = load()
  memoryState = state
  return state.issues[key] || null
}

export function setIssueState(key: string, data: Partial<IssueState>) {
  const state = load()
  state.issues[key] = { ...state.issues[key], ...data, updatedAt: Date.now() }
  save(state)
}

export function getAllIssues(): Record<string, IssueState> {
  const state = load()
  memoryState = state
  return state.issues
}

/** Fast in-memory read for the API layer (no disk I/O) */
export function getMemoryState(): State {
  return memoryState
}
