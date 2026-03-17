// Vercel Cron handler — cleanup draft products older than 24h
// Schedule: every 6 hours (configured in vercel.json)
// Secured by CRON_SECRET validation

import { defineEventHandler, getHeader } from "h3"
import { getContainer } from "../../../lib/container"

export default defineEventHandler(async (event) => {
  // Validate CRON_SECRET (Vercel sends this header for cron invocations)
  const authHeader = getHeader(event, "authorization")
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    event.node.res.statusCode = 401
    return { error: "Unauthorized" }
  }

  try {
    const { container, logger } = await getContainer()
    logger.info("[cron:cleanup-drafts] Starting cleanup job...")

    const startTime = Date.now()
    const productService = container.resolve<any>("productService")
    const deleted = await productService.deleteDraftsOlderThan(24)
    const durationMs = Date.now() - startTime

    for (const id of deleted) {
      logger.info(`[cron:cleanup-drafts] Deleted draft: ${id}`)
    }

    logger.info(`[cron:cleanup-drafts] Completed: ${deleted.length} drafts removed in ${durationMs}ms`)

    return {
      job: "cleanup-draft-products",
      status: "completed",
      deletedCount: deleted.length,
      durationMs,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Fallback to console.error if container failed to boot
    console.error(`[cron:cleanup-drafts] FAILED: ${message}`)
    return { job: "cleanup-draft-products", status: "failed", error: message }
  }
})
