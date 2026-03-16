// @manta/adapter-neon — Neon PostgreSQL connection adapter
// Provides a Drizzle db instance configured for Neon serverless.
// All queries go through Drizzle schemas in @manta/core/db.

export { createNeonDatabase } from "./connection"
export type { NeonDatabaseOptions } from "./connection"
