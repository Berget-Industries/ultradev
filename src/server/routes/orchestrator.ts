import { Router } from 'express'
import {
  getOrchestratorState,
  invalidateOrchestratorCache,
  getActivityLog,
  startPolling, stopPolling, updatePollingInterval,
  startPrPolling, stopPrPolling, updatePrPollingInterval,
  startErrorWatcher, stopErrorWatcher, runErrorWatcher,
} from '../orchestrator/index.js'
import { setRuntimePollInterval } from '../orchestrator/config.js'
import { getIssueState, setIssueState } from '../orchestrator/state.js'
import { parseLogStats } from '../orchestrator/log-parser.js'

const router = Router()

router.get('/live', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const send = () => {
    const state = getOrchestratorState()
    res.write(`data: ${JSON.stringify(state)}\n\n`)
  }

  // Send initial state immediately
  send()

  const interval = setInterval(send, 10_000)

  req.on('close', () => {
    clearInterval(interval)
  })
})

router.get('/', (_req, res) => {
  res.json(getOrchestratorState())
})

router.get('/activity', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  res.json(getActivityLog(limit))
})

router.put('/jobs/:name', (req, res) => {
  const { name } = req.params
  const { enabled, intervalMs } = req.body as { enabled?: boolean; intervalMs?: number }

  if (name === 'issue-poller') {
    if (typeof enabled === 'boolean') {
      if (enabled) {
        startPolling()
      } else {
        stopPolling()
      }
    }
    if (typeof intervalMs === 'number' && intervalMs > 0) {
      setRuntimePollInterval(intervalMs)
      updatePollingInterval(intervalMs)
    }
  } else if (name === 'pr-poller') {
    if (typeof enabled === 'boolean') {
      if (enabled) {
        startPrPolling()
      } else {
        stopPrPolling()
      }
    }
    if (typeof intervalMs === 'number' && intervalMs > 0) {
      setRuntimePollInterval(intervalMs)
      updatePrPollingInterval(intervalMs)
    }
  } else if (name === 'error-watcher') {
    if (typeof enabled === 'boolean') {
      if (enabled) {
        startErrorWatcher()
      } else {
        stopErrorWatcher()
      }
    }
  } else {
    res.status(404).json({ error: `Unknown job: ${name}` })
    return
  }

  res.json(getOrchestratorState())
})

router.post('/error-watcher/run', async (_req, res) => {
  runErrorWatcher()
  res.json({ ok: true, message: 'Error watcher triggered' })
})

router.post('/requeue/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key)
  const state = getIssueState(key)

  if (!state) {
    res.status(404).json({ error: `No item found for key: ${key}` })
    return
  }

  setIssueState(key, { status: 'failed', attempts: 0, error: 'Requeued manually', notifiedMaxRetries: false })
  invalidateOrchestratorCache()
  console.log(`[api] Requeued: ${key}`)
  res.json({ ok: true, key })
})

router.get('/queue/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key)
  const state = getIssueState(key)

  if (!state) {
    res.status(404).json({ error: `No queue item found for key: ${key}` })
    return
  }

  const logStats = state.logFile ? parseLogStats(state.logFile) : null

  res.json({
    key,
    repo: state.repo || key.split('#')[0],
    number: state.number,
    type: state.type || (key.startsWith('pr:') ? 'pr' : 'issue'),
    status: state.status,
    attempts: state.attempts || 0,
    prUrl: state.prUrl || null,
    error: state.error || null,
    logFile: state.logFile || null,
    updatedAt: state.updatedAt || null,
    toolCalls: logStats?.toolCalls ?? 0,
    costUsd: logStats?.costUsd ?? null,
    durationMs: logStats?.durationMs ?? null,
    numTurns: logStats?.numTurns ?? null,
    inputTokens: logStats?.inputTokens ?? 0,
    outputTokens: logStats?.outputTokens ?? 0,
    cacheCreationTokens: logStats?.cacheCreationTokens ?? 0,
    cacheReadTokens: logStats?.cacheReadTokens ?? 0,
    totalTokens: logStats?.totalTokens ?? 0,
    peakContext: logStats?.peakContext ?? 0,
    contextHistory: logStats?.contextHistory ?? [],
  })
})

export default router
