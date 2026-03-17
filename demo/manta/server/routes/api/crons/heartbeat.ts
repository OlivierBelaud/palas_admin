// Vercel Cron — heartbeat every minute
// Writes a row to cron_heartbeats table to prove the cron is running
// View results at /admin/crons

import { defineEventHandler, getHeader } from "h3"
import { getContainer } from "../../../lib/container"

export default defineEventHandler(async (event) => {
  // Validate CRON_SECRET
  const authHeader = getHeader(event, "authorization")
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    event.node.res.statusCode = 401
    return { error: "Unauthorized" }
  }

  const startTime = Date.now()

  try {
    const { db, logger } = await getContainer()
    logger.info("[cron:heartbeat] Tick...")

    const { cronHeartbeats } = await import("@manta/core/db")

    await db.insert(cronHeartbeats).values({
      job_name: "heartbeat",
      message: `Heartbeat at ${new Date().toISOString()} — ${Math.round(process.uptime())}s uptime`,
    })

    const durationMs = Date.now() - startTime
    logger.info(`[cron:heartbeat] Done in ${durationMs}ms`)

    return { job: "heartbeat", status: "ok", durationMs }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[cron:heartbeat] FAILED: ${message}`)
    return { job: "heartbeat", status: "failed", error: message }
  }
})
