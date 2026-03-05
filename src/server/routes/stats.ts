import { Router } from 'express'
import os from 'os'

const router = Router()

router.get('/', (_req, res) => {
  // CPU usage: calculate from os.cpus()
  const cpus = os.cpus()
  const cpuUsage = cpus.reduce((acc, cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0)
    const idle = cpu.times.idle
    return { total: acc.total + total, idle: acc.idle + idle }
  }, { total: 0, idle: 0 })
  const cpuPercent = Math.round((1 - cpuUsage.idle / cpuUsage.total) * 100)

  // Memory
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const memPercent = Math.round((usedMem / totalMem) * 100)

  // Load average
  const loadAvg = os.loadavg()

  // Uptime
  const uptime = os.uptime()

  res.json({
    cpu: { percent: cpuPercent, cores: cpus.length },
    memory: { total: totalMem, used: usedMem, free: freeMem, percent: memPercent },
    load: { '1m': loadAvg[0], '5m': loadAvg[1], '15m': loadAvg[2] },
    uptime,
    platform: os.platform(),
    hostname: os.hostname(),
  })
})

export default router
