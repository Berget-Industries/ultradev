import { Router } from 'express'
import { existsSync, statSync, openSync, readSync, closeSync } from 'fs'
import { getIssueState } from '../orchestrator/state.js'

const router = Router()

// SSE endpoint: streams log file contents, tailing for live jobs
router.get('/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key)
  const state = getIssueState(key)

  if (!state?.logFile) {
    return res.status(404).json({ error: 'No log file for this job' })
  }

  const logPath = state.logFile

  if (!existsSync(logPath)) {
    return res.status(404).json({ error: 'Log file not found on disk' })
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  let offset = 0
  let closed = false

  const sendChunk = () => {
    if (closed) return
    try {
      if (!existsSync(logPath)) return
      const size = statSync(logPath).size
      if (size <= offset) return

      const fd = openSync(logPath, 'r')
      const buf = Buffer.alloc(size - offset)
      readSync(fd, buf, 0, buf.length, offset)
      closeSync(fd)
      offset = size

      const text = buf.toString('utf-8')
      res.write(`data: ${JSON.stringify(text)}\n\n`)
    } catch { /* file may be mid-write, skip this tick */ }
  }

  // Send initial content
  sendChunk()

  // Tail every second
  const tailInterval = setInterval(sendChunk, 1000)

  // Check if job finished — send done event and close
  const doneInterval = setInterval(() => {
    if (closed) return
    const current = getIssueState(key)
    if (current && current.status !== 'in_progress') {
      sendChunk() // flush any remaining content
      res.write(`event: done\ndata: ${JSON.stringify({ status: current.status })}\n\n`)
      cleanup()
    }
  }, 2000)

  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(tailInterval)
    clearInterval(doneInterval)
    res.end()
  }

  req.on('close', cleanup)
})

// Plain GET for full log content (completed jobs)
router.get('/:key/full', (req, res) => {
  const key = decodeURIComponent(req.params.key)
  const state = getIssueState(key)

  if (!state?.logFile) {
    return res.status(404).json({ error: 'No log file for this job' })
  }

  if (!existsSync(state.logFile)) {
    return res.status(404).json({ error: 'Log file not found on disk' })
  }

  res.sendFile(state.logFile)
})

export default router
