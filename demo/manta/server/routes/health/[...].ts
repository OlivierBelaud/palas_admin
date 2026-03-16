import { defineEventHandler } from "h3"

export default defineEventHandler((event) => {
  const path = event.path || ""
  if (path.includes("ready")) {
    return { status: "ready", uptime_ms: Math.round(process.uptime() * 1000) }
  }
  return { status: "alive", uptime_ms: Math.round(process.uptime() * 1000) }
})
