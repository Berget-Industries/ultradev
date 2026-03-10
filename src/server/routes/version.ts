import { Router } from 'express'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { createRequire } from 'module'
import { platform } from 'os'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const router = Router()
const IS_LINUX = platform() === 'linux'

let cachedLatest: { tag: string; fetchedAt: number } | null = null
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

// ---------------------------------------------------------------------------
// Update progress tracking
// ---------------------------------------------------------------------------

interface UpdateStep {
  step: 'fetch' | 'checkout' | 'install' | 'migrate' | 'restart'
  status: 'pending' | 'in_progress' | 'done' | 'error'
  message: string
}

interface UpdateState {
  active: boolean
  version: string | null
  steps: UpdateStep[]
  error: string | null
}

let updateState: UpdateState = { active: false, version: null, steps: [], error: null }

function makeSteps(): UpdateStep[] {
  return [
    { step: 'fetch', status: 'pending', message: 'Fetch tags' },
    { step: 'checkout', status: 'pending', message: 'Checkout release' },
    { step: 'install', status: 'pending', message: 'Install dependencies' },
    { step: 'migrate', status: 'pending', message: 'Run database migrations' },
    { step: 'restart', status: 'pending', message: 'Restart server' },
  ]
}

function setStepStatus(
  stepName: UpdateStep['step'],
  status: UpdateStep['status'],
  message?: string,
) {
  const s = updateState.steps.find((s) => s.step === stepName)
  if (s) {
    s.status = status
    if (message) s.message = message
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getLatestRelease(): Promise<string | null> {
  if (cachedLatest && Date.now() - cachedLatest.fetchedAt < CACHE_TTL) {
    return cachedLatest.tag
  }

  try {
    const { stdout } = await execFileAsync('gh', [
      'release', 'view', '--repo', 'Berget-Industries/ultradev',
      '--json', 'tagName', '--jq', '.tagName',
    ], { timeout: 10_000, encoding: 'utf-8' })

    const tag = stdout.trim()
    if (tag) {
      cachedLatest = { tag, fetchedAt: Date.now() }
      return tag
    }
  } catch { /* no releases yet or gh not available */ }

  return null
}

// ---------------------------------------------------------------------------
// Background update runner
// ---------------------------------------------------------------------------

async function runUpdate(latestTag: string) {
  try {
    // Step 1 — fetch tags
    setStepStatus('fetch', 'in_progress', 'Fetching tags…')
    await execFileAsync('git', ['fetch', '--tags'], { timeout: 30_000, encoding: 'utf-8' })
    setStepStatus('fetch', 'done', 'Tags fetched')

    // Step 2 — checkout
    setStepStatus('checkout', 'in_progress', `Checking out ${latestTag}…`)
    await execFileAsync('git', ['checkout', latestTag], { timeout: 10_000, encoding: 'utf-8' })
    setStepStatus('checkout', 'done', `Checked out ${latestTag}`)

    // Step 3 — install
    setStepStatus('install', 'in_progress', 'Installing dependencies…')
    await execFileAsync('pnpm', ['install', '--frozen-lockfile'], {
      timeout: 120_000,
      encoding: 'utf-8',
      env: { ...process.env },
    })
    setStepStatus('install', 'done', 'Dependencies installed')

    // Step 4 — database migrations + seed
    setStepStatus('migrate', 'in_progress', 'Pushing schema changes…')
    await execFileAsync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      timeout: 60_000,
      encoding: 'utf-8',
      env: { ...process.env },
    })
    setStepStatus('migrate', 'in_progress', 'Seeding database…')
    await execFileAsync('pnpm', ['exec', 'prisma', 'db', 'seed'], {
      timeout: 60_000,
      encoding: 'utf-8',
      env: { ...process.env },
    })
    setStepStatus('migrate', 'done', 'Database updated')

    // Step 5 — restart
    setStepStatus('restart', 'in_progress', 'Restarting server…')

    if (IS_LINUX) {
      // On Linux, systemd will auto-restart the process after exit
      setStepStatus('restart', 'done', 'Restart initiated')
      updateState.active = false
      setTimeout(() => process.exit(0), 1_500)
    } else if (platform() === 'darwin') {
      // On macOS there is no service manager to respawn the process,
      // so we spawn a detached child that restarts the server after
      // the current process exits.
      const restartCmd = process.env.ULTRADEV_RESTART_CMD
        || `sleep 2 && cd "${process.cwd()}" && exec npx tsx src/server/index.ts`
      const child = spawn('/bin/bash', ['-c', restartCmd], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
      })

      child.on('error', (err) => {
        console.error('[version] Failed to spawn restart process:', err)
        setStepStatus('restart', 'error', `Restart failed: ${err.message}`)
        updateState.error = `Restart failed: ${err.message}`
        updateState.active = false
      })

      child.unref()
      setStepStatus('restart', 'done', 'Restart initiated')
      updateState.active = false
      setTimeout(() => process.exit(0), 1_500)
    } else {
      // Unsupported platform — complete the update but skip auto-restart
      setStepStatus('restart', 'error', 'Auto-restart is not supported on this platform. Please restart the server manually.')
      updateState.error = 'Manual restart required'
      updateState.active = false
    }
  } catch (err: any) {
    const failedStep = updateState.steps.find((s) => s.status === 'in_progress')
    if (failedStep) {
      failedStep.status = 'error'
      failedStep.message = err.message || 'Unknown error'
    }
    updateState.error = err.message || 'Update failed'
    updateState.active = false
    console.error('[version] Update failed:', err)
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get('/', async (_req, res) => {
  const pkg = require('../../../package.json')
  const current = `v${pkg.version}`
  const latest = await getLatestRelease()

  res.json({
    current,
    latest,
    updateAvailable: latest !== null && latest !== current,
  })
})

router.post('/update', async (_req, res) => {
  if (updateState.active) {
    res.status(409).json({ error: 'Update already in progress' })
    return
  }

  // Acquire lock immediately to prevent TOCTOU race
  updateState.active = true

  try {
    cachedLatest = null
    const latestTag = await getLatestRelease()
    if (!latestTag) {
      updateState.active = false
      res.status(404).json({ error: 'No release tags found' })
      return
    }

    // Initialise progress state and kick off the background update
    updateState.version = latestTag
    updateState.steps = makeSteps()
    updateState.error = null

    // Fire-and-forget — progress is tracked via updateState / SSE
    runUpdate(latestTag).catch((err) => {
      console.error('[version] Unexpected error in runUpdate:', err)
    })

    res.json({ started: true, version: latestTag })
  } catch (err: any) {
    updateState.active = false
    console.error('[version] Update failed:', err)
    res.status(500).json({ error: err.message || 'Update failed' })
  }
})

router.get('/update/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  let closed = false

  const send = () => {
    if (closed) return
    res.write(`data: ${JSON.stringify(updateState)}\n\n`)

    // Close the stream once we have a terminal state
    const isRestarting = updateState.steps.some(
      (s) => s.step === 'restart' && s.status === 'in_progress',
    )
    const hasError = updateState.error !== null

    if (isRestarting || hasError) {
      clearInterval(interval)
      res.end()
      closed = true
    }
  }

  // Send initial state immediately
  send()

  const interval = setInterval(send, 500)

  req.on('close', () => {
    closed = true
    clearInterval(interval)
  })
})

export default router
