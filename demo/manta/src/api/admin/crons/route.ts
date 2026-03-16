// GET /api/admin/crons — List cron heartbeats from DB
// Proves that Vercel Cron is running every minute

import type { MantaRequest } from "@manta/cli"
import { desc } from "drizzle-orm"
import { cronHeartbeats } from "../../../../../../packages/core/src/db/schema"

export async function GET(req: MantaRequest) {
  const db = req.scope.resolve<any>("db")

  const beats = await db.select().from(cronHeartbeats).orderBy(desc(cronHeartbeats.executed_at)).limit(50)

  return Response.json({
    count: beats.length,
    heartbeats: beats.map((b: any) => ({
      id: b.id,
      job: b.job_name,
      message: b.message,
      executedAt: b.executed_at,
    })),
  })
}
