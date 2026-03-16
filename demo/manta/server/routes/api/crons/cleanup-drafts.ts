// Vercel Cron handler — cleanup draft products older than 24h
// Schedule: every 6 hours (configured in vercel.json)
// Secured by CRON_SECRET validation

import { defineEventHandler, getRequestURL, getHeader } from "h3"

export default defineEventHandler(async (event) => {
  // Validate CRON_SECRET (Vercel sends this header for cron invocations)
  const authHeader = getHeader(event, "authorization")
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    event.node.res.statusCode = 401
    return { error: "Unauthorized" }
  }

  console.log("[cron:cleanup-drafts] Starting cleanup job...")

  // Bootstrap container (reuse from catch-all handler pattern)
  const { getOrBootstrapContainer } = await import("../[...path]" as any).catch(() => null) || {}

  // For now, inline a lightweight bootstrap for the cron job
  try {
    const { NeonWorkflowStorageAdapter } = await import("@manta/adapter-neon" as any)
    const postgres = (await import("postgres")).default
    const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 })

    // Track job execution
    await sql`
      INSERT INTO job_executions (job_name, status, started_at)
      VALUES ('cleanup-draft-products', 'running', NOW())
    `
    const startTime = Date.now()

    // Find and delete drafts older than 24h
    const deleted = await sql`
      DELETE FROM products
      WHERE status = 'draft' AND created_at < NOW() - INTERVAL '24 hours'
      RETURNING id, title
    `

    const durationMs = Date.now() - startTime

    // Log each deleted product
    for (const row of deleted) {
      console.log(`[cron:cleanup-drafts] Deleted draft: ${row.id} — "${row.title}"`)
    }

    // Persist event for each deleted product
    for (const row of deleted) {
      await sql`
        INSERT INTO events (event_name, data, metadata, status)
        VALUES ('product.cleaned', ${JSON.stringify({ id: row.id, title: row.title })}::jsonb, ${JSON.stringify({ source: 'cron', timestamp: Date.now() })}::jsonb, 'pending')
      `
    }

    // Update job execution record
    await sql`
      UPDATE job_executions
      SET status = 'completed', duration_ms = ${durationMs},
          result = ${JSON.stringify({ deletedCount: deleted.length, deletedIds: deleted.map((r: any) => r.id) })}::jsonb,
          completed_at = NOW()
      WHERE job_name = 'cleanup-draft-products' AND status = 'running'
      ORDER BY started_at DESC LIMIT 1
    `

    console.log(`[cron:cleanup-drafts] Completed: ${deleted.length} drafts removed in ${durationMs}ms`)

    await sql.end()

    return {
      job: "cleanup-draft-products",
      status: "completed",
      deletedCount: deleted.length,
      durationMs,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[cron:cleanup-drafts] FAILED: ${message}`)
    return { job: "cleanup-draft-products", status: "failed", error: message }
  }
})
