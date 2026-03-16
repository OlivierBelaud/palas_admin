// StatsService — Drizzle ORM implementation

import { eq, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import { stats } from "@manta/core/db"

export class StatsService {
  private db: PostgresJsDatabase

  constructor(db: PostgresJsDatabase) {
    this.db = db
  }

  async increment(key: string): Promise<void> {
    await this.db.insert(stats)
      .values({ key, value: 1 })
      .onConflictDoUpdate({
        target: stats.key,
        set: { value: sql`${stats.value} + 1` },
      })
  }

  async get(key: string): Promise<number> {
    const [row] = await this.db.select({ value: stats.value })
      .from(stats)
      .where(eq(stats.key, key))

    return row?.value ?? 0
  }

  async _reset(): Promise<void> {
    await this.db.delete(stats)
  }
}
