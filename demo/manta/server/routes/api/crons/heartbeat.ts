// Vercel Cron — heartbeat every minute
// Writes a row to cron_heartbeats table to prove the cron is running
// View results at /admin/crons

import { defineEventHandler, getHeader } from "h3"

export default defineEventHandler(async (event) => {
  // Validate CRON_SECRET
  const authHeader = getHeader(event, "authorization")
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    event.node.res.statusCode = 401
    return { error: "Unauthorized" }
  }

  const startTime = Date.now()
  console.log("[cron:heartbeat] Tick...")

  try {
    const postgres = (await import("postgres")).default
    const { drizzle } = await import("drizzle-orm/postgres-js")
    const { cronHeartbeats } = await import("@manta/core/db")

    const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 })
    const db = drizzle(sql)

    await db.insert(cronHeartbeats).values({
      job_name: "heartbeat",
      message: `Heartbeat at ${new Date().toISOString()} — ${Math.round(process.uptime())}s uptime`,
    })

    await sql.end()

    const durationMs = Date.now() - startTime
    console.log(`[cron:heartbeat] Done in ${durationMs}ms`)

    return { job: "heartbeat", status: "ok", durationMs }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[cron:heartbeat] FAILED: ${message}`)
    return { job: "heartbeat", status: "failed", error: message }
  }
})
