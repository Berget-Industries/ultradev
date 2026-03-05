import { logActivity } from './activity-log.js'

export async function notify(message: string) {
  console.log(`[notify] ${message}`)
  logActivity('notify', message)

  // Lazy import to avoid circular dependency with discord-bot
  const { dmOwner } = await import('./discord-bot.js')
  await dmOwner(message)
}
