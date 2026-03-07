import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

let redis: Redis | null = null
let connected = false

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 3) return null // stop retrying
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true,
    })

    redis.on('connect', () => {
      connected = true
      console.log('[cache] Redis connected')
    })
    redis.on('error', (err) => {
      if (connected) console.error('[cache] Redis error:', err.message)
      connected = false
    })
    redis.on('close', () => { connected = false })

    redis.connect().catch(() => {
      console.warn('[cache] Redis not available — running without cache')
    })
  }
  return redis
}

export function isRedisConnected(): boolean {
  return connected
}

/**
 * Get cached JSON value, or compute and store it.
 * Falls back to in-memory if Redis is down.
 */
const memFallback = new Map<string, { data: string; expiresAt: number }>()

export async function cached<T>(key: string, ttlSeconds: number, compute: () => T | Promise<T>): Promise<T> {
  const r = getRedis()

  // Try Redis first
  if (connected) {
    try {
      const val = await r.get(key)
      if (val !== null) return JSON.parse(val) as T
    } catch { /* fall through */ }
  }

  // Check in-memory fallback
  const mem = memFallback.get(key)
  if (mem && Date.now() < mem.expiresAt) {
    return JSON.parse(mem.data) as T
  }

  // Compute fresh value
  const result = await compute()
  const json = JSON.stringify(result)

  // Store in Redis
  if (connected) {
    r.setex(key, ttlSeconds, json).catch(() => {})
  }

  // Always store in memory fallback
  memFallback.set(key, { data: json, expiresAt: Date.now() + ttlSeconds * 1000 })

  return result
}

/**
 * Invalidate a cache key (both Redis and in-memory).
 */
export async function invalidate(key: string): Promise<void> {
  memFallback.delete(key)
  if (connected) {
    getRedis().del(key).catch(() => {})
  }
}

/**
 * Invalidate all keys matching a pattern.
 */
export async function invalidatePattern(pattern: string): Promise<void> {
  // Clear matching in-memory keys
  for (const k of memFallback.keys()) {
    if (k.startsWith(pattern.replace('*', ''))) {
      memFallback.delete(k)
    }
  }
  if (connected) {
    try {
      const keys = await getRedis().keys(pattern)
      if (keys.length > 0) await getRedis().del(...keys)
    } catch { /* ok */ }
  }
}
