import { Router } from 'express'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { execSync } from 'child_process'
import { MAINTENANCE_FILE } from '../paths.js'

const router = Router()

router.get('/', (_req, res) => {
  const enabled = existsSync(MAINTENANCE_FILE)
  res.json({ enabled })
})

router.post('/', (req, res) => {
  const { enabled } = req.body

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' })
  }

  try {
    if (enabled) {
      // Create maintenance file
      writeFileSync(MAINTENANCE_FILE, new Date().toISOString(), 'utf-8')
      // Stop the standalone ultradev service (if running separately)
      try {
        execSync('systemctl --user stop ultradev 2>/dev/null || true', { timeout: 10000 })
      } catch { /* ignore — may not be running */ }
      console.log('[maintenance] Maintenance mode ENABLED — all polling stopped')
    } else {
      // Remove maintenance file
      if (existsSync(MAINTENANCE_FILE)) {
        unlinkSync(MAINTENANCE_FILE)
      }
      // Start the standalone ultradev service
      try {
        execSync('systemctl --user start ultradev 2>/dev/null || true', { timeout: 10000 })
      } catch { /* ignore */ }
      console.log('[maintenance] Maintenance mode DISABLED — polling resumed')
    }

    res.json({ enabled })
  } catch (err: any) {
    console.error('[maintenance] Error toggling maintenance mode:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
