import { Router } from 'express'
import { execSync } from 'child_process'

const router = Router()

interface AgentProcess {
  pid: number
  command: string
  cwd: string
  uptime: string
  role: 'worker' | 'reviewer' | 'session'
  label: string
}

function classifyAgent(command: string, cwd: string): { role: AgentProcess['role']; label: string } {
  if (command.includes('--output-format stream-json')) {
    // Orchestrator worker — extract issue key from cwd
    const worktreeMatch = cwd.match(/worktrees\/(.+)$/)
    const label = worktreeMatch ? worktreeMatch[1].replace(/_/g, '#') : cwd.replace(/^.*\/repos\//, '')
    return { role: 'worker', label }
  }
  return { role: 'session', label: 'Interactive Session' }
}

router.get('/', (_req, res) => {
  try {
    // Use pgrep to find only processes whose binary name is exactly "claude"
    // then get details via ps. This avoids matching shell subprocesses that
    // happen to contain "claude" in their args (snapshot paths, etc.)
    const pids = execSync(
      'pgrep -x claude 2>/dev/null || true',
      { encoding: 'utf-8', timeout: 5000 }
    ).trim()

    if (!pids) {
      return res.json({ running: false, count: 0, agents: [] })
    }

    const pidList = pids.split('\n').filter(Boolean)
    const agents: AgentProcess[] = pidList.map(pidStr => {
      const pid = parseInt(pidStr)
      let command = ''
      let uptime = ''
      let cwd = ''

      try {
        command = execSync(
          `ps -p ${pid} -o args= 2>/dev/null`,
          { encoding: 'utf-8', timeout: 2000 }
        ).trim()
        uptime = execSync(
          `ps -p ${pid} -o etime= 2>/dev/null`,
          { encoding: 'utf-8', timeout: 2000 }
        ).trim()
      } catch {}

      try {
        cwd = execSync(`readlink -f /proc/${pid}/cwd 2>/dev/null`, { encoding: 'utf-8', timeout: 2000 }).trim()
      } catch {}

      const { role, label } = classifyAgent(command, cwd)
      return { pid, command, cwd, uptime, role, label }
    })

    res.json({ running: agents.length > 0, count: agents.length, agents })
  } catch {
    res.json({ running: false, count: 0, agents: [] })
  }
})

// Kill a specific agent by PID
router.delete('/:pid', (req, res) => {
  const pid = parseInt(req.params.pid)
  if (isNaN(pid) || pid <= 0) {
    return res.status(400).json({ error: 'Invalid PID' })
  }
  try {
    process.kill(pid, 'SIGKILL')
    res.json({ ok: true, killed: pid })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Kill all claude --print workers
router.delete('/', (_req, res) => {
  try {
    execSync('pkill -9 -f "claude.*--print" 2>/dev/null || true', { timeout: 5000 })
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
