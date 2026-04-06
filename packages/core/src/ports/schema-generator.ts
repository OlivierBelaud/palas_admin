// SPEC-057f — ISchemaGenerator port
// Decouples DML→schema generation from any specific ORM (Drizzle, etc.)

import type { ParsedDmlEntity } from '../dml/generator'

/**
 * Schema generator port contract.
 * Transforms parsed DML entities into ORM-specific schema definitions.
 * Adapters: DrizzleSchemaGenerator (prod), future alternatives.
 */
export interface ISchemaGenerator {
  /**
   * Generate an ORM-specific schema from a parsed DML entity.
   * @param entity - The parsed DML entity definition
   * @returns The generated schema (type depends on adapter)
   */
  generate(entity: ParsedDmlEntity): unknown
}
