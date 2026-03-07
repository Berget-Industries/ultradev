import { useState, useEffect, useCallback, useRef } from 'react'

// --- Module-level cache ---

interface CacheEntry<T = unknown> {
  data: T
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

// Track in-flight requests to avoid duplicate fetches
const inflight = new Map<string, Promise<unknown>>()

// Subscribers: components re-render when their key's data changes
type Listener = () => void
const listeners = new Map<string, Set<Listener>>()

function subscribe(key: string, listener: Listener) {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key)!.add(listener)
  return () => {
    listeners.get(key)!.delete(listener)
    if (listeners.get(key)!.size === 0) listeners.delete(key)
  }
}

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn())
}

// --- Core fetch logic ---

async function doFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  // Deduplicate concurrent requests for the same key
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>

  const promise = fetcher()
    .then((data) => {
      cache.set(key, { data, fetchedAt: Date.now() })
      inflight.delete(key)
      notify(key)
      return data
    })
    .catch((err) => {
      inflight.delete(key)
      throw err
    })

  inflight.set(key, promise)
  return promise
}

// --- React hook ---

const DEFAULT_TTL = 30_000 // 30 seconds

export function useStore<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts?: { ttl?: number; pollInterval?: number },
): { data: T | null; loading: boolean; refresh: () => void } {
  const ttl = opts?.ttl ?? DEFAULT_TTL
  const pollInterval = opts?.pollInterval

  const cached = cache.get(key) as CacheEntry<T> | undefined

  const [data, setData] = useState<T | null>(cached?.data ?? null)
  const [loading, setLoading] = useState(!cached)

  // Keep fetcher ref stable to avoid re-triggering effects when the caller
  // passes an inline arrow function
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const refresh = useCallback(() => {
    setLoading((prev) => (data === null ? true : prev))
    doFetch(key, () => fetcherRef.current()).catch(() => {
      // Errors are swallowed for background refreshes; stale data stays visible.
      // The initial load (no cached data) will still show loading=true until
      // the next successful fetch or until the component unmounts.
    })
  }, [key, data])

  // Subscribe to cache updates for this key
  useEffect(() => {
    const unsub = subscribe(key, () => {
      const entry = cache.get(key) as CacheEntry<T> | undefined
      if (entry) {
        setData(entry.data)
        setLoading(false)
      }
    })
    return unsub
  }, [key])

  // On mount (or key change): if no cache, fetch. If stale, background refresh.
  useEffect(() => {
    const entry = cache.get(key) as CacheEntry<T> | undefined
    if (!entry) {
      setLoading(true)
      doFetch(key, () => fetcherRef.current()).catch(() => {})
    } else {
      setData(entry.data)
      setLoading(false)
      if (Date.now() - entry.fetchedAt > ttl) {
        // Stale — refresh in background, keep showing cached data
        doFetch(key, () => fetcherRef.current()).catch(() => {})
      }
    }
  }, [key, ttl])

  // Optional polling
  useEffect(() => {
    if (!pollInterval) return
    const id = setInterval(() => {
      doFetch(key, () => fetcherRef.current()).catch(() => {})
    }, pollInterval)
    return () => clearInterval(id)
  }, [key, pollInterval])

  return { data, loading, refresh }
}

// --- Utilities ---

/** Manually set a cache entry (useful after mutations) */
export function setCache<T>(key: string, data: T) {
  cache.set(key, { data, fetchedAt: Date.now() })
  notify(key)
}

/** Invalidate a cache entry so the next useStore mount fetches fresh */
export function invalidate(key: string) {
  cache.delete(key)
  notify(key)
}

/** Clear the entire cache */
export function clearCache() {
  cache.clear()
}
