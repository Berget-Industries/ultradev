import db from '../db.js'

interface ProjectRow {
  repo_url: string
}

/**
 * Get the set of allowed repo identifiers (owner/repo) from active projects.
 * Returns null if no projects exist (open access / unconfigured).
 * Returns a Set of lowercase "owner/repo" strings if projects exist.
 */
export function getAllowedRepos(): Set<string> | null {
  const allProjects = db.prepare('SELECT repo_url FROM projects').all() as ProjectRow[]
  if (allProjects.length === 0) return null // no projects configured = allow all

  const activeProjects = db.prepare(
    "SELECT repo_url FROM projects WHERE status = 'active' AND repo_url != ''"
  ).all() as ProjectRow[]

  const set = new Set<string>()
  for (const p of activeProjects) {
    const name = extractNameWithOwner(p.repo_url)
    if (name) set.add(name.toLowerCase())
  }
  return set
}

/**
 * Check if a repo (in "owner/repo" format) is allowed.
 */
export function isRepoAllowed(nameWithOwner: string): boolean {
  const allowed = getAllowedRepos()
  if (allowed === null) return true // no projects configured = allow all
  return allowed.has(nameWithOwner.toLowerCase())
}

/**
 * Extract "owner/repo" from various URL formats:
 * - https://github.com/owner/repo
 * - github.com/owner/repo
 * - owner/repo
 */
function extractNameWithOwner(repoUrl: string): string | null {
  const trimmed = repoUrl.trim().replace(/\/+$/, '')
  const urlMatch = trimmed.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/)
  if (urlMatch) return urlMatch[1]
  const bareMatch = trimmed.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/)
  if (bareMatch) return bareMatch[1]
  return null
}
