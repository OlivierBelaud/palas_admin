import { defineEventHandler } from "h3"
import { getContainer } from "../../lib/container"

export default defineEventHandler(async (event) => {
  const path = event.path || ""

  if (path.includes("ready")) {
    try {
      const { rawSql } = await getContainer()
      await rawSql("SELECT 1")
      return { status: "ready", uptime_ms: Math.round(process.uptime() * 1000), checks: { database: "ok" } }
    } catch {
      event.node.res.statusCode = 503
      return { status: "not_ready", uptime_ms: Math.round(process.uptime() * 1000), checks: { database: "failed" } }
    }
  }

  return { status: "alive", uptime_ms: Math.round(process.uptime() * 1000) }
})
