// SPEC-057e — DmlEntity class with type guards

import { MantaError } from '../errors/manta-error'

/**
 * A DML property definition created by property factory functions.
 * Field names use 'is_' prefix to avoid collision with fluent method names
 * (e.g. .nullable() method vs is_nullable field).
 */
export interface DmlPropertyDefinition {
  __dml: true
  type: string
  is_nullable: boolean
  default_value?: unknown
  is_indexed?: boolean | string
  is_unique?: boolean | string
  is_primaryKey: boolean
  is_computed: boolean
  is_searchable: boolean
  is_translatable: boolean
  values?: unknown
}

/**
 * A DML relation definition.
 */
export interface DmlRelationDefinition {
  __dmlRelation: true
  type: 'hasOne' | 'hasOneWithFK' | 'belongsTo' | 'hasMany' | 'manyToMany'
  target: () => DmlEntity
  options?: Record<string, unknown>
  /** Entity name when using string form (e.g. belongsTo('Customer')). */
  _entityName?: string
}

/**
 * Options for DmlEntity (indexes, checks, cascades).
 */
export interface DmlEntityOptions {
  indexes?: Array<{
    on: string[]
    unique?: boolean
    where?: string | Record<string, unknown>
    name?: string
    type?: string
  }>
  checks?: Array<{
    name?: string
    expression: string | ((columns: Record<string, string>) => string)
  }>
  cascades?: {
    delete?: string[]
    detach?: string[]
  }
  tableName?: string
  /**
   * Mark this entity as external — it lives in an external system (PostHog, Stripe, etc.).
   * The framework will:
   *  - NOT generate a database table
   *  - NOT generate migrations
   *  - NOT auto-generate a CRUD service
   * But it WILL register the entity in the entity registry so it can be queried via `query_entity`,
   * described via `describe_entity`, and linked to local entities via `defineLink`.
   *
   * External entities require a resolver registered via `extendQueryGraph()` in the same module.
   */
  external?: boolean
}

/**
 * DML entity — the output of model.define().
 * Holds the schema definition for code generation.
 *
 * The generic parameter Schema preserves the exact property types for TypeScript inference
 * via InferEntity<T>. Default is Record<string, unknown> for backward compatibility.
 */
export class DmlEntity<Schema extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string
  readonly schema: Schema
  __module?: string
  private _options: DmlEntityOptions = {}

  constructor(name: string, schema: Schema) {
    if (!name) {
      throw new MantaError(
        'INVALID_DATA',
        'Entity name is required. Usage: defineModel("Product", { title: field.text() })',
      )
    }
    if (!/^[A-Z]/.test(name)) {
      throw new MantaError(
        'INVALID_DATA',
        `Entity name must be PascalCase (got "${name}"). Change to "${name.charAt(0).toUpperCase() + name.slice(1)}"`,
      )
    }
    if (Object.keys(schema).length === 0) {
      throw new MantaError(
        'INVALID_DATA',
        `Entity "${name}" must have at least one property. Add properties with field.text(), field.number(), etc.`,
      )
    }
    this.name = name
    this.schema = schema
  }

  /**
   * Add composite indexes to this entity.
   * @param indexes - Index definitions
   * @returns this (fluent API)
   */
  indexes(indexes: DmlEntityOptions['indexes']): this {
    this._options.indexes = indexes
    return this
  }

  /**
   * Add CHECK constraints.
   * @param checks - Check definitions
   * @returns this (fluent API)
   */
  checks(checks: DmlEntityOptions['checks']): this {
    this._options.checks = checks
    return this
  }

  /**
   * Configure cascade behavior for soft-delete.
   * @param cascades - Cascade rules
   * @returns this (fluent API)
   */
  cascades(cascades: DmlEntityOptions['cascades']): this {
    this._options.cascades = cascades
    return this
  }

  /**
   * Override the default table name.
   * @param name - Custom table name
   * @returns this (fluent API)
   */
  tableName(name: string): this {
    this._options.tableName = name
    return this
  }

  /**
   * Mark this entity as external — lives in a third-party system (PostHog, Stripe, etc.).
   * The framework will NOT generate a database table, migration, or auto-CRUD service for it.
   * The entity remains visible to the query graph, AI tools, and links.
   *
   * External entities MUST have a resolver registered via `extendQueryGraph()` in the same module.
   *
   * @example
   *   export default defineModel('PostHogEvent', {
   *     id: field.text().primaryKey(),
   *     event: field.text(),
   *     timestamp: field.dateTime(),
   *   }).external()
   */
  external(): this {
    this._options.external = true
    return this
  }

  /**
   * Check if this entity is marked as external.
   */
  isExternal(): boolean {
    return this._options.external === true
  }

  /**
   * Get all configuration options.
   */
  getOptions(): DmlEntityOptions {
    return { ...this._options }
  }

  /**
   * Type guard: is this a DmlPropertyDefinition?
   */
  static isProperty(value: unknown): value is DmlPropertyDefinition {
    return (
      typeof value === 'object' && value !== null && '__dml' in value && (value as DmlPropertyDefinition).__dml === true
    )
  }

  /**
   * Type guard: is this a DmlRelationDefinition?
   */
  static isRelation(value: unknown): value is DmlRelationDefinition {
    return (
      typeof value === 'object' &&
      value !== null &&
      '__dmlRelation' in value &&
      (value as DmlRelationDefinition).__dmlRelation === true
    )
  }
}
