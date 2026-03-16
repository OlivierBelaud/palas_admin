// SPEC-057b — DmlProperty class with fluent/chainable modifier API

import type { DmlPropertyDefinition } from './entity'

/**
 * DML property with fluent API for chaining modifiers.
 *
 * Usage:
 *   model.text().nullable().default('untitled').unique()
 *
 * Compatible with DmlPropertyDefinition — the class has all the same fields
 * and passes DmlEntity.isProperty() type guard.
 */
export class DmlProperty implements DmlPropertyDefinition {
  readonly __dml = true as const
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

  constructor(type: string, init?: Partial<Omit<DmlPropertyDefinition, '__dml' | 'type'>>) {
    this.type = type
    if (init) {
      if (init.nullable !== undefined) this.nullable = init.nullable
      if (init.default !== undefined) this.default = init.default
      if (init.index !== undefined) this.index = init.index
      if (init.unique !== undefined) this.unique = init.unique
      if (init.primaryKey !== undefined) this.primaryKey = init.primaryKey
      if (init.computed !== undefined) this.computed = init.computed
      if (init.searchable !== undefined) this.searchable = init.searchable
      if (init.translatable !== undefined) this.translatable = init.translatable
      if (init.values !== undefined) this.values = init.values
    }
  }

  /** Mark property as nullable (column allows NULL). */
  setNullable(value = true): this {
    this.nullable = value
    return this
  }

  /** Set a default value for the column. */
  setDefault(value: unknown): this {
    this.default = value
    return this
  }

  /** Add an index on this column. */
  indexed(name?: string): this {
    this.index = name ?? true
    return this
  }

  /** Add a unique constraint on this column. */
  setUnique(name?: string): this {
    this.unique = name ?? true
    return this
  }

  /** Mark as computed (no column generated in DB). */
  setComputed(): this {
    this.computed = true
    return this
  }

  /** Mark as searchable (indexed for full-text search). */
  setSearchable(): this {
    this.searchable = true
    return this
  }

  /** Mark as translatable (subject to ITranslationPort). */
  setTranslatable(): this {
    this.translatable = true
    return this
  }
}
