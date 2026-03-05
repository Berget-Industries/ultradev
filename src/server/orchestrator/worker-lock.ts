/**
 * Global worker lock — ensures only ONE claude worker runs at a time across all pollers.
 */

let activeWorkers = 0

export function isWorkerSlotFree(): boolean {
  return activeWorkers === 0
}

export function claimWorkerSlot(): boolean {
  if (activeWorkers > 0) return false
  activeWorkers++
  return true
}

export function releaseWorkerSlot() {
  activeWorkers = Math.max(0, activeWorkers - 1)
}

export function getActiveWorkerCount(): number {
  return activeWorkers
}
