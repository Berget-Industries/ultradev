/** Convert camelCase keys to snake_case recursively. Applied at route boundary. */
export function toSnakeCase<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj
  if (obj instanceof Date) return obj as T
  if (Array.isArray(obj)) return obj.map(toSnakeCase) as T

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
    result[snakeKey] = toSnakeCase(value)
  }
  return result as T
}
