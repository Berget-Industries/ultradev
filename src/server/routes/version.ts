import { Router } from 'express'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const router = Router()

let cachedLatest: { tag: string; fetchedAt: number } | null = null
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

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

export default router
