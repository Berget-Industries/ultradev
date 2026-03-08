import { prisma } from '../prisma.js'

interface PromptTemplateData {
  template: string
  maxAttempts: number
  timeoutMs: number
}

let cache = new Map<string, { data: PromptTemplateData; ts: number }>()
const CACHE_TTL = 30_000

export function invalidateTemplateCache() {
  cache = new Map()
}

export async function getPromptTemplate(slug: string): Promise<PromptTemplateData | null> {
  const cached = cache.get(slug)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data

  const row = await prisma.promptTemplate.findUnique({ where: { slug } })
  if (!row || !row.template) return null

  const data: PromptTemplateData = {
    template: row.template,
    maxAttempts: row.maxAttempts,
    timeoutMs: row.timeoutMs,
  }
  cache.set(slug, { data, ts: Date.now() })
  return data
}
