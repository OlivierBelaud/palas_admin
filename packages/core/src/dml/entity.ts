// SPEC-057e — DmlEntity class with type guards

/**
 * A DML property definition created by property factory functions.
 */
export interface DmlPropertyDefinition {
  __dml: true
  type: string
  nullable?: boolean
  default?: unknown
  index?: boolean | string
  unique?: boolean | string
  primaryKey?: boolean
  computed?: boolean
  searchable?: boolean
  translatable?: boolean
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
}

/**
 * DML entity — the output of model.define().
 * Holds the schema definition for code generation.
 */
export class DmlEntity {
  readonly name: string
  readonly schema: Record<string, DmlPropertyDefinition | DmlRelationDefinition>
  private _options: DmlEntityOptions = {}

  constructor(name: string, schema: Record<string, DmlPropertyDefinition | DmlRelationDefinition>) {
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
   * Get all configuration options.
   */
  getOptions(): DmlEntityOptions {
    return { ...this._options }
  }

  /**
   * Type guard: is this a DmlPropertyDefinition?
   */
  static isProperty(value: unknown): value is DmlPropertyDefinition {
    return typeof value === 'object' && value !== null && '__dml' in value && (value as DmlPropertyDefinition).__dml === true
  }

  /**
   * Type guard: is this a DmlRelationDefinition?
   */
  static isRelation(value: unknown): value is DmlRelationDefinition {
    return typeof value === 'object' && value !== null && '__dmlRelation' in value && (value as DmlRelationDefinition).__dmlRelation === true
  }
}
