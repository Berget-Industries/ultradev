import { prisma } from '../prisma.js'

/**
 * Get the set of allowed repo identifiers (owner/repo) from active projects.
 * Returns null if no projects exist (open access / unconfigured).
 * Returns a Set of lowercase "owner/repo" strings if projects exist.
 */
export async function getAllowedRepos(): Promise<Set<string> | null> {
  const allProjects = await prisma.project.findMany({ select: { repoUrl: true } })
  if (allProjects.length === 0) return null // no projects configured = allow all

  const activeProjects = await prisma.project.findMany({
    where: { status: 'active', repoUrl: { not: '' } },
    select: { repoUrl: true },
  })

  const set = new Set<string>()
  for (const p of activeProjects) {
    const name = extractNameWithOwner(p.repoUrl)
    if (name) set.add(name.toLowerCase())
  }
  return set
}

/**
 * Check if a repo (in "owner/repo" format) is allowed.
 */
export async function isRepoAllowed(nameWithOwner: string): Promise<boolean> {
  const allowed = await getAllowedRepos()
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
