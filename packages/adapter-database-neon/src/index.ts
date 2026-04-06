// @manta/adapter-database-neon — Neon serverless IDatabasePort adapter

// Re-export Drizzle tools from @manta/adapter-database-pg for convenience
export { DrizzleRepository, DrizzleRepositoryFactory, DrizzleSchemaGenerator } from '@manta/adapter-database-pg'
export { NeonDrizzleAdapter } from './adapter'
export type { NeonDatabase, NeonDatabaseOptions } from './connection'
export { createNeonDatabase } from './connection'
